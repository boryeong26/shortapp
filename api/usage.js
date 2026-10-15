// GET /api/usage
//
// Reports the current ElevenLabs TTS credit usage so the page can show
// "오늘의 단락 생성"이 쓰는 할당량이 얼마나 남았는지, without exposing the
// ElevenLabs API key itself to the browser. Calls ElevenLabs'
// GET /v1/user/subscription server-side and returns just the numbers.
//
// Requires ELEVENLABS_API_KEY to be set as a Vercel env var (in addition
// to the GitHub Actions secret of the same name used by
// scripts/daily-pick.js — these are two separate places).

const { applyCors } = require('../lib/cors');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET 요청만 지원합니다.' });
    return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: '서버에 ELEVENLABS_API_KEY가 설정되어 있지 않습니다.' });
    return;
  }

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
      headers: { 'xi-api-key': apiKey }
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('usage (ElevenLabs) error:', response.status, errText);
      res.status(502).json({ error: 'ElevenLabs 사용량을 가져오지 못했습니다.' });
      return;
    }

    const data = await response.json();
    const used = Number(data.character_count) || 0;
    const limit = Number(data.character_limit) || 0;
    const resetUnix = Number(data.next_character_count_reset_unix) || null;

    res.status(200).json({
      elevenlabs: {
        used,
        limit,
        remaining: limit > 0 ? Math.max(limit - used, 0) : null,
        resetAt: resetUnix ? new Date(resetUnix * 1000).toISOString() : null
      }
    });
  } catch (err) {
    console.error('usage error:', err);
    res.status(500).json({ error: '사용량 조회 중 오류가 발생했습니다.' });
  }
};
