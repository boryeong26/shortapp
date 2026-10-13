// Writes a short Korean recommendation blurb for each YouTube search
// result, via the Claude API. One call covers a whole page of results
// (not one call per video), so cost stays flat regardless of how many
// of them the user ends up saving.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';

function buildPrompt(topic, candidates) {
  const list = candidates
    .map((c, i) => `${i + 1}. [${c.videoId}] "${c.title}" (채널: ${c.channelTitle}${c.description ? `, 설명: ${c.description}` : ''})`)
    .join('\n');

  return `당신은 한국어를 모국어로 쓰는, 영어 회화를 공부 중인 학습자를 위한 유튜브 영상 큐레이터입니다.
검색 주제: "${topic}" (이 주제에 관한 영어 회화/표현을 배우려는 것이지, 한국어를 배우려는 것이 아닙니다 — 영상이 영어로 되어 있는 것은 정상이고 오히려 바람직합니다.)

아래는 그 검색어로 찾은 유튜브 영상 목록입니다. 각 영상의 제목과 설명만 보고, 이 영상이 "${topic}"과 관련된 영어 표현을 배우는 데 도움이 될지 판단하는 아주 짧은 추천 코멘트를 작성하세요.

영상 목록:
${list}

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트나 마크다운 코드블록 없이 순수 JSON만 출력합니다:

{
  "items": [
    { "videoId": "...", "comment": "..." },
    ...
  ]
}

comment 작성 규칙:
- 제목/설명에서 확인 가능한 내용만 근거로 삼고, 모르는 내용은 지어내지 마세요.
- 1~2문장, 한국어로. "이 영상은 ~에게 좋습니다" 같은 추천 포인트 위주로 작성하세요.
- 영상이 영어로 되어 있다는 이유로 "한국어 학습에 맞지 않는다"는 식의 코멘트는 절대 쓰지 마세요 — 그건 이 서비스의 정상적인 전제입니다.
- 영상 내용이 불분명하면 솔직하게 "제목만으로는 내용을 확신하기 어렵습니다" 같은 식으로 적어도 됩니다.
- items 배열은 목록에 있는 모든 영상을 videoId와 함께 빠짐없이 포함해야 합니다.`;
}

function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

async function callClaude(prompt, apiKey) {
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
  return (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

// candidates: array of { videoId, title, channelTitle, description }.
// Returns a Map<videoId, comment>. Missing/unparseable entries are
// simply absent from the map — callers should treat a missing comment
// as "no AI comment available" rather than fail the whole request.
async function generateCommentary(topic, candidates, apiKey) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return new Map();
  }

  const prompt = buildPrompt(topic, candidates);
  const rawText = await callClaude(prompt, apiKey);
  if (!rawText) return new Map();

  let parsed;
  try {
    parsed = JSON.parse(stripCodeFences(rawText));
  } catch (e) {
    return new Map();
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const map = new Map();
  for (const item of items) {
    if (item && item.videoId && item.comment) {
      map.set(String(item.videoId), String(item.comment).trim());
    }
  }
  return map;
}

module.exports = { generateCommentary, buildPrompt, callClaude };
