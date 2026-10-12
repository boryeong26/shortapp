// Node script run by the "대본 생성 (순위 영상)" GitHub Actions workflow.
//
// The user has already searched + picked + ranked 5 YouTube clips on the
// page (see api/search-youtube-clips.js); this just asks Claude to write
// the commentary narration for them and writes the combined result to
// scripts/latest.json, which index.html reads and displays for editing.

const fs = require('fs');
const path = require('path');
const { generateRankScript, RANK_COUNT } = require('../lib/scriptGenerator');

function parseSelectedClips(raw) {
  let clips;
  try {
    clips = JSON.parse(raw || '[]');
  } catch (e) {
    throw new Error('SELECTED_CLIPS를 JSON으로 해석하지 못했습니다.');
  }

  if (!Array.isArray(clips) || clips.length !== RANK_COUNT) {
    throw new Error(`선택된 클립은 정확히 ${RANK_COUNT}개여야 합니다.`);
  }

  return clips.map((c) => ({
    rank: Number(c.rank),
    videoId: String(c.videoId || ''),
    title: String(c.title || ''),
    channelTitle: String(c.channelTitle || ''),
    channelId: String(c.channelId || ''),
    url: String(c.url || ''),
    description: String(c.description || '').slice(0, 300),
    start: Number(c.start) || 0,
    end: Number(c.end) || 0
  }));
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY 환경변수가 설정되어 있지 않습니다.');
    process.exit(1);
  }

  const topic = process.env.GENERATE_TOPIC || '순위 모음';
  const selectedClips = parseSelectedClips(process.env.SELECTED_CLIPS);

  const result = await generateRankScript({ topic, items: selectedClips }, apiKey);

  const output = {
    generatedAt: new Date().toISOString(),
    topic: result.topic,
    items: [
      { type: 'intro', narration: result.intro },
      ...result.items.map((item) => ({ type: 'rank', ...item })),
      { type: 'outro', narration: result.outro }
    ]
  };

  const outPath = path.join(__dirname, 'latest.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log(`대본을 생성해 ${outPath}에 저장했습니다.`);
  console.log(result.intro);
  result.items.forEach((item) => console.log(`[${item.rank}위] ${item.title} - ${item.narration}`));
  console.log(result.outro);
}

main().catch((err) => {
  console.error('스크립트 생성 중 오류가 발생했습니다:', err);
  process.exit(1);
});
