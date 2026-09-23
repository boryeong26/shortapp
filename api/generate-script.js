// POST /api/generate-script
// Generates a Korean-language short-form science-trivia video script.
//
// Request body: { topic?, tone?, keyword?, duration? }
// Response: { script: string } | { error: string }

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';

const ALLOWED_DURATIONS = new Set(['30', '60', '90']);

function estimateWordBudget(duration) {
  // Rough Korean narration pace for shorts: ~4.5 words/sec.
  const seconds = Number(duration) || 60;
  return Math.round(seconds * 4.5);
}

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
  body = body || {};

  const topic = typeof body.topic === 'string' && body.topic.trim() ? body.topic.trim() : '랜덤';
  const tone = typeof body.tone === 'string' && body.tone.trim() ? body.tone.trim() : '흥미진진하고 호기심을 자극하는';
  const keyword = typeof body.keyword === 'string' ? body.keyword.trim().slice(0, 100) : '';
  const duration = ALLOWED_DURATIONS.has(String(body.duration)) ? String(body.duration) : '60';
  const wordBudget = estimateWordBudget(duration);

  const topicLine = topic === '랜덤'
    ? '과학 전 분야(우주, 물리학, 생물학, 화학, 뇌과학, 인체, 지구과학, 테크놀로지 등) 중에서 대중이 놀라워할 만한 주제를 하나 자유롭게 선택하세요.'
    : `주제 분야: ${topic}`;

  const keywordLine = keyword ? `세부 키워드/소재: ${keyword}` : '';

  const prompt = `당신은 유튜브 쇼츠·틱톡용 과학상식 영상의 전문 대본 작가입니다.
아래 조건에 맞는 ${duration}초 분량의 숏폼 대본을 한국어로 작성하세요.

${topicLine}
${keywordLine}
톤앤매너: ${tone} 톤으로 작성하세요.
분량: 내레이션 기준 약 ${wordBudget}단어 내외 (${duration}초 낭독 분량).

대본 구조는 반드시 아래 형식을 따르세요:
[훅] - 첫 2~3초 안에 시청자의 호기심을 강하게 자극하는 한두 문장
[본문] - 핵심 과학 정보를 쉽고 흥미롭게 설명 (여러 문장/문단 가능)
[반전 또는 결론] - 놀라운 사실이나 인상적인 마무리 한두 문장
[CTA] - 팔로우/좋아요/댓글을 유도하는 짧은 멘트 한 문장

주의사항:
- 반드시 과학적으로 정확한 사실만 사용하세요. 확실하지 않은 정보는 넣지 마세요.
- 전문 용어는 최소화하고 쉬운 말로 풀어서 설명하세요.
- 각 섹션 제목([훅], [본문], [반전 또는 결론], [CTA])을 그대로 표시하고, 그 아래에 실제 내레이션 텍스트만 작성하세요.
- 카메라 지시문이나 자막 디자인 설명은 넣지 말고 순수 내레이션 대사만 작성하세요.`;

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      res.status(502).json({ error: '대본 생성 서비스에서 오류가 발생했습니다.' });
      return;
    }

    const data = await response.json();
    const script = (data.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (!script) {
      res.status(502).json({ error: '대본을 생성하지 못했습니다. 다시 시도해주세요.' });
      return;
    }

    res.status(200).json({ script });
  } catch (err) {
    console.error('generate-script error:', err);
    res.status(500).json({ error: '대본 생성 중 오류가 발생했습니다.' });
  }
};
