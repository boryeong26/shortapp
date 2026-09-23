// POST /api/generate-script
// Generates a Korean-language short-form science-trivia video script.
//
// Request body: { topic?, tone?, keyword?, duration? }
// Response: { script: string } | { error: string }

const { generateScript } = require('../lib/scriptGenerator');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: '서버에 ANTHROPIC_API_KEY가 설정되어 있지 않습니다.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      res.status(400).json({ error: '요청 본문을 해석할 수 없습니다.' });
      return;
    }
  }

  try {
    const result = await generateScript(body || {}, apiKey);
    res.status(200).json({ script: result.script, scenes: result.scenes });
  } catch (err) {
    console.error('generate-script error:', err);
    const status = err.status ? 502 : 500;
    const message = err.status
      ? '대본 생성 서비스에서 오류가 발생했습니다.'
      : (err.message || '대본 생성 중 오류가 발생했습니다.');
    res.status(status).json({ error: message });
  }
};
