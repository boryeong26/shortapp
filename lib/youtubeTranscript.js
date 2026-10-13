// Fetches a YouTube video's caption track (manual or auto-generated) via
// the unofficial `timedtext` endpoint and finds where a given phrase is
// actually spoken, so the page can jump a player straight to that
// moment instead of making the user scrub through the whole video.
//
// This endpoint isn't part of the official YouTube Data API — it's the
// same one youtube-transcript-style tools use — so it can change or
// stop working without notice. A video with no captions (or captions
// YouTube won't serve this way) just yields no match, handled as a
// normal "not found" rather than an error.

// Two domains serve the same unofficial timedtext endpoint. www.youtube.com
// returned HTTP 200 with a silent empty body for every request from this
// app's server IP (confirmed via Vercel logs) — tried first anyway since
// it's the current one, then falls back to the older video.google.com
// domain, which sometimes isn't gated the same way.
const TIMEDTEXT_HOSTS = ['https://www.youtube.com/api/timedtext', 'https://video.google.com/timedtext'];

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9'
};

async function fetchText(url) {
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) return { ok: false, status: res.status, text: '' };
  const text = await res.text();
  return { ok: true, status: res.status, text };
}

// The old approach of guessing lang=en/en-US/a.en mostly failed, because
// most videos' only English track is auto-generated, and the modern
// endpoint identifies that with a separate kind=asr parameter rather than
// an "a." lang prefix. So instead of guessing, ask the endpoint what
// tracks actually exist (?type=list) and request the exact one found —
// same approach youtube-transcript-style tools use. Tries each known host
// in turn since one of them has been observed silently blocking this app's
// server IP (empty 200 body) while still answering on another host.
async function listCaptionTracks(videoId) {
  for (const host of TIMEDTEXT_HOSTS) {
    const url = `${host}?type=list&v=${encodeURIComponent(videoId)}`;
    const { ok, status, text } = await fetchText(url);
    if (!ok) {
      console.error(`[youtubeTranscript] list fetch failed for ${videoId} via ${host}: HTTP ${status}`);
      continue;
    }
    if (!text) {
      console.error(`[youtubeTranscript] list fetch for ${videoId} via ${host} returned empty body (HTTP ${status})`);
      continue;
    }

    const tracks = [];
    const trackRe = /<track\b[^>]*>/g;
    let match;
    while ((match = trackRe.exec(text)) !== null) {
      const tag = match[0];
      const attr = (name) => {
        const m = new RegExp(`${name}="([^"]*)"`).exec(tag);
        return m ? m[1] : '';
      };
      tracks.push({
        langCode: attr('lang_code'),
        kind: attr('kind'), // 'asr' for auto-generated, '' for manual
        host
      });
    }
    if (tracks.length > 0) return tracks;
  }
  return [];
}

function pickEnglishTrack(tracks) {
  const english = tracks.filter((t) => t.langCode === 'en' || t.langCode.startsWith('en-'));
  if (english.length === 0) return null;
  // Prefer a manually authored track over an auto-generated one.
  return english.find((t) => t.kind !== 'asr') || english[0];
}

async function fetchCaptionEvents(videoId, track) {
  const params = new URLSearchParams({ v: videoId, lang: track.langCode, fmt: 'json3' });
  if (track.kind) params.set('kind', track.kind);

  const url = `${track.host}?${params.toString()}`;
  const { ok, status, text } = await fetchText(url);
  if (!ok) {
    console.error(`[youtubeTranscript] events fetch failed for ${videoId} via ${track.host}: HTTP ${status}`);
    return null;
  }
  if (!text) {
    console.error(`[youtubeTranscript] events fetch for ${videoId} via ${track.host} returned empty body (HTTP ${status})`);
    return null;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return null;
  }

  if (!Array.isArray(data.events)) return null;

  return data.events
    .filter((ev) => Array.isArray(ev.segs) && typeof ev.tStartMs === 'number')
    .map((ev) => ({
      startSeconds: ev.tStartMs / 1000,
      text: ev.segs.map((seg) => seg.utf8 || '').join('')
    }))
    .filter((seg) => seg.text.trim().length > 0);
}

function normalize(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function getCaptionSegments(videoId) {
  const tracks = await listCaptionTracks(videoId);
  console.error(`[youtubeTranscript] ${videoId}: ${tracks.length} caption track(s) found (${tracks.map((t) => `${t.langCode}${t.kind ? `/${t.kind}` : ''}`).join(', ')})`);

  const track = pickEnglishTrack(tracks);
  if (!track) return null;

  const segments = await fetchCaptionEvents(videoId, track);
  console.error(`[youtubeTranscript] ${videoId}: ${segments ? segments.length : 0} caption segment(s) parsed`);
  return segments && segments.length > 0 ? segments : null;
}

// Finds the first point in the video's captions where `phrase` appears,
// by concatenating caption segments into one continuous string (captions
// often split a sentence across multiple cues) and mapping the match
// position back to the segment it started in.
function findPhraseTimestamp(segments, phrase) {
  const needle = normalize(phrase);
  if (!needle) return null;

  let combined = '';
  const offsets = []; // offsets[i] = { charIndex, startSeconds } for segments[i]

  for (const seg of segments) {
    offsets.push({ charIndex: combined.length, startSeconds: seg.startSeconds });
    combined += `${normalize(seg.text)} `;
  }

  const matchIndex = combined.indexOf(needle);
  if (matchIndex === -1) return null;

  // Find the last segment whose charIndex is <= matchIndex.
  let matchedSeg = offsets[0];
  for (const entry of offsets) {
    if (entry.charIndex <= matchIndex) matchedSeg = entry;
    else break;
  }

  // Start a couple seconds early so the phrase isn't cut off mid-word.
  return Math.max(0, Math.round(matchedSeg.startSeconds - 1));
}

// candidate: { videoId, title, channelTitle, url }
// Returns { ...candidate, startSeconds } or null if the phrase wasn't
// found in that video's captions (or it has none).
async function findPhraseInVideo(candidate, phrase) {
  const segments = await getCaptionSegments(candidate.videoId);
  if (!segments) return null;

  const startSeconds = findPhraseTimestamp(segments, phrase);
  if (startSeconds === null) return null;

  return { ...candidate, startSeconds };
}

module.exports = { findPhraseInVideo, findPhraseTimestamp, getCaptionSegments };
