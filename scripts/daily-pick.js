// Node script run by the "오늘의 기초 영어회화" GitHub Actions workflow
// (scheduled daily at 07:00 KST). Picks a fresh basic-English-conversation
// topic/phrase, then produces two things for it: a page of recommended
// YouTube videos (data/daily.json) and a ~10-sentence practice paragraph
// with Korean translations + per-sentence TTS audio
// (data/daily-paragraph.json + data/daily-paragraph/*.mp3). Keeps a
// short history of recent topics (data/daily-history.json) so Claude is
// told what to avoid repeating.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { searchVideos } = require('../lib/youtubeSearch');
const { generateCommentary, callClaude } = require('../lib/recommendCommentary');
const { generateDailyParagraph } = require('../lib/dailyParagraph');
const { synthesizeSpeech } = require('../lib/tts');

const DAILY_PATH = path.join(__dirname, '..', 'data', 'daily.json');
const PARAGRAPH_JSON_PATH = path.join(__dirname, '..', 'data', 'daily-paragraph.json');
const PARAGRAPH_DIR = path.join(__dirname, '..', 'data', 'daily-paragraph');
const HISTORY_PATH = path.join(__dirname, '..', 'data', 'daily-history.json');
const HISTORY_LIMIT = 30;

function loadHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.topics) ? parsed.topics : [];
  } catch (e) {
    return [];
  }
}

function saveHistory(topics) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify({ topics: topics.slice(-HISTORY_LIMIT) }, null, 2) + '\n', 'utf8');
}

function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

async function pickTodaysTopic(apiKey, recentTopics) {
  const avoidLine = recentTopics.length > 0
    ? `최근에 이미 다룬 주제들이라 오늘은 피해주세요: ${recentTopics.join(', ')}`
    : '';

  const prompt = `당신은 한국어 사용자를 위한 "오늘의 기초 영어회화" 코너를 매일 운영하는 편집자입니다.
오늘 다룰 기초 영어회화 주제/표현을 하나 골라주세요. 왕초보도 바로 써먹을 수 있는 실생활 표현이어야 합니다 (인사, 주문하기, 길 묻기, 감사 표현, 전화 응대 등).
${avoidLine}

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트나 마크다운 코드블록 없이 순수 JSON만 출력합니다:

{ "topic": "짧은 주제명 (한국어)", "searchQuery": "유튜브 검색에 쓸 영어 검색어" }`;

  const rawText = await callClaude(prompt, apiKey);
  const parsed = JSON.parse(stripCodeFences(rawText));
  if (!parsed.topic || !parsed.searchQuery) {
    throw new Error('오늘의 주제를 생성하지 못했습니다 (topic/searchQuery 누락).');
  }
  return parsed;
}

async function main() {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    console.error('ANTHROPIC_API_KEY 환경변수가 설정되어 있지 않습니다.');
    process.exit(1);
  }
  if (!process.env.YOUTUBE_API_KEY) {
    console.error('YOUTUBE_API_KEY 환경변수가 설정되어 있지 않습니다.');
    process.exit(1);
  }
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error('ELEVENLABS_API_KEY 환경변수가 설정되어 있지 않습니다.');
    process.exit(1);
  }

  const recentTopics = loadHistory();
  console.log(`최근 ${recentTopics.length}개 주제 이력 로드됨.`);

  const { topic, searchQuery } = await pickTodaysTopic(anthropicApiKey, recentTopics);
  console.log(`오늘의 주제: ${topic} (검색어: ${searchQuery})`);

  const candidates = await searchVideos(searchQuery, { maxResults: 8 });
  console.log(`  -> ${candidates.length}개 영상 검색됨`);

  let commentary = new Map();
  if (candidates.length > 0) {
    commentary = await generateCommentary(topic, candidates, anthropicApiKey);
  }

  const items = candidates.slice(0, 5).map((c) => ({
    ...c,
    comment: commentary.get(c.videoId) || null
  }));

  const output = {
    date: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    topic,
    searchQuery,
    items
  };

  fs.writeFileSync(DAILY_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log('오늘의 영어 단락 생성 중...');
  const paragraph = await generateDailyParagraph(topic, anthropicApiKey);
  console.log(`  -> "${paragraph.title}" (${paragraph.sentences.length}문장)`);

  fs.rmSync(PARAGRAPH_DIR, { recursive: true, force: true });
  fs.mkdirSync(PARAGRAPH_DIR, { recursive: true });

  console.log('  -> 문장별 TTS 음성 생성 중 (ElevenLabs)...');
  const sentenceFiles = [];
  const sentencesWithAudio = [];
  for (let i = 0; i < paragraph.sentences.length; i++) {
    const sentence = paragraph.sentences[i];
    const fileName = `${String(i + 1).padStart(2, '0')}.mp3`;
    const audioBuffer = await synthesizeSpeech(sentence.en);
    fs.writeFileSync(path.join(PARAGRAPH_DIR, fileName), audioBuffer);
    sentenceFiles.push(fileName);
    sentencesWithAudio.push({ ...sentence, audio: `daily-paragraph/${fileName}` });
    console.log(`     [${i + 1}/${paragraph.sentences.length}] ${fileName} (${audioBuffer.length} bytes)`);
  }

  // Joins the already-synthesized per-sentence clips into one full-paragraph
  // file instead of making a second (duplicate-cost) TTS call for the
  // whole text — same codec/bitrate from ElevenLabs throughout, so a
  // stream-copy concat is safe.
  console.log('  -> 전체 음성 합치는 중 (ffmpeg)...');
  const concatListPath = path.join(PARAGRAPH_DIR, 'concat-list.txt');
  const concatList = sentenceFiles.map((f) => `file '${f}'`).join('\n') + '\n';
  fs.writeFileSync(concatListPath, concatList, 'utf8');
  execFileSync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', 'full.mp3'
  ], { cwd: PARAGRAPH_DIR, stdio: 'inherit' });
  fs.rmSync(concatListPath);
  console.log('  -> daily-paragraph/full.mp3');

  const paragraphOutput = {
    date: output.date,
    generatedAt: output.generatedAt,
    topic,
    title: paragraph.title,
    sentences: sentencesWithAudio,
    audio: 'daily-paragraph/full.mp3'
  };
  fs.writeFileSync(PARAGRAPH_JSON_PATH, JSON.stringify(paragraphOutput, null, 2) + '\n', 'utf8');

  saveHistory([...recentTopics, topic]);

  console.log(`완료: ${DAILY_PATH}, ${PARAGRAPH_JSON_PATH}에 저장됨.`);
}

main().catch((err) => {
  console.error('오늘의 영어회화 생성 중 오류가 발생했습니다:', err);
  process.exit(1);
});
