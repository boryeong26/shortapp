// POST /api/search-phrase
// Body: { phrase }
// Response: { matches: [{ videoId, title, channelTitle, url, startSeconds }] }
//
// Searches YouTube for videos likely to contain the given English
// sentence/phrase, then checks each candidate's captions for the exact
// phrase and the timestamp it's spoken at. Lets the page show the same
// sentence said by several different speakers, each jumping straight to
// that moment — nothing is downloaded, captions + the normal YouTube
// embed player (with a start-time param) do the work.

const { applyCors } = require('../lib/cors');
const { searchVideos } = require('../lib/youtubeSearch');
const { findPhraseInVideo } = require('../lib/youtubeTranscript');

const MAX_CANDIDATES = 8;
const MAX_MATCHES = 5;

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
    const candidates = await searchVideos(phrase, { maxResults: MAX_CANDIDATES, relevanceLanguage: 'en' });

    const results = await Promise.all(
      candidates.map((c) => findPhraseInVideo(c, phrase).catch(() => null))
    );

    const matches = results.filter(Boolean).slice(0, MAX_MATCHES);

    res.status(200).json({
      matches,
      searchedCount: candidates.length,
      note: matches.length === 0
        ? '검색된 영상 중 자막에서 이 문장을 정확히 찾은 영상이 없습니다. 문장을 조금 다르게(짧게, 또는 핵심 표현만) 시도해보세요.'
        : null
    });
  } catch (err) {
    console.error('search-phrase error:', err);
    res.status(502).json({ error: err.message || '문장 검색 중 오류가 발생했습니다.' });
  }
};
