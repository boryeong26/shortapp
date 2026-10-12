// Shared logic for generating a Korean "TOP 5 순위" short-form narration
// script via the Claude API, for a compilation video assembled from
// Creative Commons-licensed YouTube clips the user has already picked and
// ranked on the page. Used by both api/generate-rank-script.js (if added
// later) and scripts/generate-script.js (GitHub Actions runner).
//
// Unlike a from-scratch script, the model here is writing commentary
// *about* specific real clips (title/channel/description given to it),
// not inventing its own visuals — so the output is just narration text
// per item, not a visual/background description.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';

const RANK_COUNT = 5;

function buildPrompt({ topic, items }) {
  const clipList = items
    .slice()
    .sort((a, b) => b.rank - a.rank) // present 5위 -> 1위, build-up order
    .map((item) => `- ${item.rank}위: "${item.title}" (채널: ${item.channelTitle}${item.description ? `, 설명: ${item.description}` : ''})`)
    .join('\n');

  return `당신은 유튜브 쇼츠 "TOP ${RANK_COUNT} 순위 모음" 영상의 전문 내레이션 작가입니다.
아래는 사용자가 이미 고르고 순위를 매긴 실제 영상 클립 목록입니다. 이 클립들 위에 입힐 해설 내레이션을 한국어로 작성하세요.

주제: ${topic}

클립 목록 (${RANK_COUNT}위부터 1위 순서):
${clipList}

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트나 마크다운 코드블록 없이 순수 JSON만 출력합니다:

{
  "intro": "...",
  "items": [
    { "rank": ${RANK_COUNT}, "narration": "..." },
    ...
    { "rank": 1, "narration": "..." }
  ],
  "outro": "..."
}

각 필드 설명:
- intro: 영상을 여는 후킹 멘트. "오늘은 ${topic} TOP ${RANK_COUNT}를 준비했습니다" 같은 뻔한 소개보다, 시청자가 끝까지 보고 싶게 만드는 한두 문장.
- items[].narration: 해당 순위 클립을 보여주면서 나올 해설. 그 클립이 왜 이 순위인지, 뭐가 신기하거나 재미있는지를 짧고 생생하게 설명하세요. "N위는 바로 이 영상입니다" 식으로 순위를 자연스럽게 언급하세요. 클립당 2~4문장.
- outro: 마무리 + 팔로우/좋아요 유도 한두 문장.
- 모든 필드는 한국어로, 실제 사람이 말하듯 자연스러운 구어체로 작성하세요.
- items 배열은 반드시 ${RANK_COUNT}개여야 하고, rank는 입력으로 주어진 값과 정확히 일치해야 합니다.`;
}

function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

async function callClaude({ prompt, apiKey }) {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    const err = new Error(`Anthropic API error (${response.status}): ${errText}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const rawText = (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  if (data.stop_reason === 'max_tokens') {
    const err = new Error('대본이 max_tokens 한도에 걸려 잘렸습니다. 다시 시도해주세요.');
    err.truncated = true;
    throw err;
  }

  return rawText;
}

function parseRankScript(rawText, expectedRanks) {
  const jsonText = stripCodeFences(rawText);

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    const err = new Error('모델 응답을 JSON으로 해석하지 못했습니다.');
    err.rawText = rawText;
    throw err;
  }

  const intro = String(parsed.intro || '').trim();
  const outro = String(parsed.outro || '').trim();
  const items = Array.isArray(parsed.items) ? parsed.items : null;

  if (!intro || !outro || !items) {
    throw new Error('응답에 intro/items/outro가 모두 있어야 합니다.');
  }

  const narrationByRank = new Map();
  for (const item of items) {
    const rank = Number(item.rank);
    const narration = String(item.narration || '').trim();
    if (rank && narration) narrationByRank.set(rank, narration);
  }

  const missing = expectedRanks.filter((r) => !narrationByRank.has(r));
  if (missing.length > 0) {
    throw new Error(`다음 순위의 내레이션이 응답에 없습니다: ${missing.join(', ')}위`);
  }

  return { intro, outro, narrationByRank };
}

// items: array of { rank, videoId, title, channelTitle, channelId, url,
// description, start, end } already selected/ranked by the user on the
// page. Returns the same items with a `narration` field added, plus a
// standalone intro/outro narration.
async function generateRankScript({ topic, items }, apiKey) {
  if (!Array.isArray(items) || items.length !== RANK_COUNT) {
    throw new Error(`items는 정확히 ${RANK_COUNT}개여야 합니다.`);
  }

  const expectedRanks = items.map((item) => Number(item.rank)).sort((a, b) => b - a);
  const prompt = buildPrompt({ topic, items });
  const rawText = await callClaude({ prompt, apiKey });

  if (!rawText) {
    throw new Error('대본을 생성하지 못했습니다.');
  }

  const { intro, outro, narrationByRank } = parseRankScript(rawText, expectedRanks);

  const rankedItems = items
    .slice()
    .map((item) => ({ ...item, narration: narrationByRank.get(Number(item.rank)) }))
    .sort((a, b) => b.rank - a.rank);

  return { topic, intro, outro, items: rankedItems };
}

module.exports = {
  RANK_COUNT,
  buildPrompt,
  callClaude,
  parseRankScript,
  generateRankScript
};
