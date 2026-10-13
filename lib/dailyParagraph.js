// Writes a short (~10 sentence) everyday-English practice paragraph for
// a given topic, with a Korean translation per sentence, via Claude.
// Used by scripts/daily-pick.js to pair with that day's video
// recommendations — same topic, different format (read/listen vs watch).

const { callClaude } = require('./recommendCommentary');

const SENTENCE_COUNT = 10;

function buildPrompt(topic) {
  return `당신은 한국어 사용자를 위한 일상 영어회화 교재 작가입니다.
주제: "${topic}"

이 주제에 관한 자연스러운 일상 영어 대화/설명 단락을 작성하세요. 실제로 그 상황에서 쓸 법한 ${SENTENCE_COUNT}개 문장으로 구성하고, 전체가 하나의 자연스러운 흐름(대화 또는 짧은 이야기)을 이루도록 하세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트나 마크다운 코드블록 없이 순수 JSON만 출력합니다:

{
  "title": "짧은 제목 (한국어)",
  "sentences": [
    { "en": "...", "ko": "..." },
    ...
  ]
}

규칙:
- sentences 배열은 정확히 ${SENTENCE_COUNT}개여야 합니다.
- en: 쉽고 자연스러운 일상 영어 문장 (왕초보~초중급 수준, 실생활에서 바로 쓸 수 있는 표현 위주).
- ko: en 문장의 자연스러운 한국어 번역 (직역이 아니라 실제로 쓰는 표현으로).
- 문장들은 서로 이어져서 하나의 짧은 대화나 이야기가 되도록 하세요 (뜬금없는 문장 나열 금지).`;
}

function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

async function generateDailyParagraph(topic, apiKey) {
  const prompt = buildPrompt(topic);
  const rawText = await callClaude(prompt, apiKey);
  if (!rawText) {
    throw new Error('오늘의 영어 단락을 생성하지 못했습니다.');
  }

  const parsed = JSON.parse(stripCodeFences(rawText));
  const sentences = Array.isArray(parsed.sentences) ? parsed.sentences : [];

  if (!parsed.title || sentences.length === 0) {
    throw new Error('응답에 title/sentences가 없습니다.');
  }

  return {
    title: String(parsed.title),
    sentences: sentences.map((s) => ({
      en: String(s.en || '').trim(),
      ko: String(s.ko || '').trim()
    })).filter((s) => s.en && s.ko)
  };
}

module.exports = { generateDailyParagraph, buildPrompt };
