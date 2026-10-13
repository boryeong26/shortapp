// POST /api/search-phrase
// Body: { phrase }
// Response: { matches: [{ videoId, title, channelTitle, url, startSeconds: 0 }] }
//
// Searches YouTube for videos likely to contain the given English
// sentence/phrase, so the page can show several different speakers
// saying (roughly) the same thing side by side. This does NOT jump to
// the exact moment the phrase is spoken — finding that requires reading
// each video's captions, and YouTube's caption endpoint was confirmed
// (via server logs) to silently block requests from this app's server
// IP, on every host/header combination tried. So this just surfaces
// candidate videos; the user finds the exact moment themselves via
// YouTube's own captions/search-in-video.

const { applyCors } = require('../lib/cors');
const { searchVideos } = require('../lib/youtubeSearch');

const MAX_MATCHES = 6;
const MAX_DURATION_SECONDS = 15;

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const phrase = typeof body.phrase === 'string' ? body.phrase.trim().slice(0, 200) : '';
  if (!phrase) {
    res.status(400).json({ error: '검색할 문장을 입력하세요.' });
    return;
  }

  try {
    // YouTube's API has no "under 1 minute" filter, only coarse buckets
    // (videoDuration=short means under 4 minutes) — so ask for short
    // videos, then further filter down to <=60s ourselves using the
    // real duration from searchVideos(). Requests extra results since
    // most of the "short" bucket is still over a minute.
    const candidates = await searchVideos(phrase, {
      maxResults: 50,
      relevanceLanguage: 'en',
      videoDuration: 'short'
    });

    const shortEnough = candidates.filter((c) => c.durationSeconds && c.durationSeconds <= MAX_DURATION_SECONDS);

    const matches = shortEnough.slice(0, MAX_MATCHES).map((c) => ({
      videoId: c.videoId,
      title: c.title,
      channelTitle: c.channelTitle,
      url: c.url,
      startSeconds: 0
    }));

    res.status(200).json({
      matches,
      note: matches.length === 0
        ? `5초 이내로는 관련 영상을 찾지 못했습니다. 그렇게 짧은 영상 자체가 드물어서일 수 있어요 — 다른 문장으로 시도해보세요.`
        : null
    });
  } catch (err) {
    console.error('search-phrase error:', err);
    res.status(502).json({ error: err.message || '문장 검색 중 오류가 발생했습니다.' });
  }
};
