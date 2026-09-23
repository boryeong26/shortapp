// Node script run by the "소재수집 + 대본생성" GitHub Actions workflow.
// Generates one science-trivia short-form script and writes it to
// scripts/latest.json, which index.html reads and displays.
//
// Reads params from env vars (set by the workflow from workflow_dispatch
// inputs) and ANTHROPIC_API_KEY from GitHub Secrets.

const fs = require('fs');
const path = require('path');
const { generateScript } = require('../lib/scriptGenerator');

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY 환경변수가 설정되어 있지 않습니다.');
    process.exit(1);
  }

  const input = {
    topic: process.env.GENERATE_TOPIC,
    tone: process.env.GENERATE_TONE,
    keyword: process.env.GENERATE_KEYWORD,
    duration: process.env.GENERATE_DURATION
  };

  const result = await generateScript(input, apiKey);

  const output = {
    generatedAt: new Date().toISOString(),
    topic: result.topic,
    tone: result.tone,
    keyword: result.keyword,
    duration: result.duration,
    script: result.script
  };

  const outPath = path.join(__dirname, 'latest.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log(`대본을 생성해 ${outPath}에 저장했습니다.`);
  console.log(output.script);
}

main().catch((err) => {
  console.error('스크립트 생성 중 오류가 발생했습니다:', err);
  process.exit(1);
});
