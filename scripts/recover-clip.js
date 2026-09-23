// One-off recovery tool: looks up a single Kling task by its
// external_task_id and downloads the result video if it's still
// available on Kling's side. Used to try to recover a clip that
// succeeded but whose scene later fell back to a gradient background
// before this project added per-clip retry (see generate-video.js).
//
// Usage: EXTERNAL_TASK_ID=<id> KLING_API_KEY=<key> node scripts/recover-clip.js

const fs = require('fs');
const path = require('path');
const { pollVideoTask, downloadVideo } = require('../lib/videoGen');

async function main() {
  const externalTaskId = process.env.EXTERNAL_TASK_ID || process.argv[2];
  if (!externalTaskId) {
    console.error('EXTERNAL_TASK_ID 환경변수 또는 첫 번째 인자로 task id를 지정하세요.');
    process.exit(1);
  }

  console.log(`조회 중: ${externalTaskId}`);
  const result = await pollVideoTask(externalTaskId, { maxAttempts: 1, intervalMs: 0 });
  console.log(`영상을 찾았습니다: ${result.url} (길이: ${result.duration}초)`);

  const buffer = await downloadVideo(result.url);
  const outDir = path.join(__dirname, '..', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'recovered-clip.mp4');
  fs.writeFileSync(outPath, buffer);
  console.log(`저장 완료: ${outPath} (${buffer.length} bytes)`);
}

main().catch((err) => {
  console.error(`복구 실패: ${err.message}`);
  process.exit(1);
});
