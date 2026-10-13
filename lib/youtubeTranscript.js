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

const TIMEDTEXT_BASE = 'https://www.youtube.com/api/timedtext';

async function fetchCaptionEvents(videoId, lang) {
  const url = `${TIMEDTEXT_BASE}?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}&fmt=json3`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const text = await res.text();
  if (!text) return null;

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

// Tries a couple of language variants since a video's captions might be
// manually authored English, auto-generated English, or (rarely) just
// whatever the uploader's default was.
async function getCaptionSegments(videoId) {
  for (const lang of ['en', 'en-US', 'a.en']) {
    const segments = await fetchCaptionEvents(videoId, lang);
    if (segments && segments.length > 0) return segments;
  }
  return null;
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
