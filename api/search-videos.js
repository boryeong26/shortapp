// POST /api/search-videos
// Body: { query }
// Response: { candidates: [{ videoId, title, channelTitle, thumbnail, durationSeconds, url, comment }] }
//
// Searches YouTube for videos matching the query, then asks Claude for a
// short Korean recommendation comment per result (one Claude call for
// the whole page of results). Nothing is downloaded — this only ever
// links out to YouTube.
//
// No login/auth gate: anyone who can load the page can trigger this,
// which calls both the YouTube Data API and the Claude API. Fine for
// personal/low-traffic use; if this page gets wider traffic, that's an
// open cost/quota exposure worth reconsidering.

const { applyCors } = require('../lib/cors');
const { searchVideos } = require('../lib/youtubeSearch');
const { generateCommentary } = require('../lib/recommendCommentary');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 100) : '';
  if (!query) {
    res.status(400).json({ error: '검색어가 필요합니다.' });
    return;
  }

  try {
    const candidates = await searchVideos(query);

    let commentary = new Map();
    if (anthropicApiKey && candidates.length > 0) {
      try {
        commentary = await generateCommentary(query, candidates, anthropicApiKey);
      } catch (err) {
        console.warn('generateCommentary failed, returning results without AI comments:', err.message);
      }
    }

    const withComments = candidates.map((c) => ({
      ...c,
      comment: commentary.get(c.videoId) || null
    }));

    res.status(200).json({ candidates: withComments });
  } catch (err) {
    console.error('search-videos error:', err);
    res.status(502).json({ error: err.message || 'YouTube 검색 중 오류가 발생했습니다.' });
  }
};
