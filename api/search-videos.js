// POST /api/search-videos
// Body: { token, query }
// Response: { candidates: [{ videoId, title, channelTitle, thumbnail, durationSeconds, url, comment }] }
//
// Searches YouTube for videos matching the query, then asks Claude for a
// short Korean recommendation comment per result (one Claude call for
// the whole page of results). Nothing is downloaded — this only ever
// links out to YouTube.

const { applyCors } = require('../lib/cors');
const { verifySessionToken } = require('../lib/auth');
const { searchVideos } = require('../lib/youtubeSearch');
const { generateCommentary } = require('../lib/recommendCommentary');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }

  const authSecret = process.env.AUTH_SECRET;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!authSecret) {
    res.status(500).json({ error: '서버에 AUTH_SECRET이 설정되어 있지 않습니다.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  if (!verifySessionToken(body.token, authSecret)) {
    res.status(401).json({ error: '로그인이 만료되었거나 유효하지 않습니다. 다시 로그인해주세요.' });
    return;
  }

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
