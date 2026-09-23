// Node script run by the "영상 제작" GitHub Actions workflow.
//
// Reads scripts/latest.json (produced by generate-script.js), splits the
// script into narration segments, synthesizes speech per segment via
// ElevenLabs, measures each segment's actual audio duration, builds an
// .ass subtitle track synced to those durations, generates a topic-based
// gradient background, and composites everything into a 9:16 mp4 with
// ffmpeg. The result is written to build/output.mp4 for the workflow to
// upload as an artifact.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { parseScriptSegments } = require('../lib/scriptSegments');
const { synthesizeSpeech } = require('../lib/tts');
const { generateBackgroundImage, WIDTH, HEIGHT } = require('../lib/background');
const { buildAssSubtitles } = require('../lib/subtitles');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const FPS = 25;

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' });
}

function ffprobeDuration(filePath) {
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath
  ]).toString().trim();
  const seconds = parseFloat(out);
  if (!Number.isFinite(seconds)) {
    throw new Error(`ffprobe에서 ${filePath}의 길이를 읽지 못했습니다.`);
  }
  return seconds;
}

async function main() {
  const latestPath = path.join(__dirname, 'latest.json');
  if (!fs.existsSync(latestPath)) {
    console.error('scripts/latest.json이 없습니다. 먼저 대본 생성 워크플로우를 실행하세요.');
    process.exit(1);
  }

  const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  if (!latest.script) {
    console.error('scripts/latest.json에 생성된 대본(script)이 없습니다.');
    process.exit(1);
  }

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('1/6 대본을 세그먼트로 분리 중...');
  const segments = parseScriptSegments(latest.script);
  console.log(`  -> ${segments.length}개 세그먼트: ${segments.map((s) => s.label).join(', ')}`);

  console.log('2/6 세그먼트별 음성 생성 중 (ElevenLabs)...');
  const audioPaths = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const audioBuffer = await synthesizeSpeech(seg.text);
    const audioPath = path.join(BUILD_DIR, `segment-${i}.mp3`);
    fs.writeFileSync(audioPath, audioBuffer);
    audioPaths.push(audioPath);
    console.log(`  -> [${seg.label}] 생성 완료 (${audioBuffer.length} bytes)`);
  }

  console.log('3/6 세그먼트 길이 측정 및 타이밍 계산 중...');
  let cursor = 0;
  const timedSegments = segments.map((seg, i) => {
    const duration = ffprobeDuration(audioPaths[i]);
    const timed = { ...seg, start: cursor, duration };
    cursor += duration;
    return timed;
  });
  const totalDuration = cursor;
  console.log(`  -> 총 길이: ${totalDuration.toFixed(2)}초`);

  console.log('4/6 오디오 트랙 병합 중...');
  const mergedAudioPath = path.join(BUILD_DIR, 'audio.mp3');
  {
    const inputArgs = audioPaths.flatMap((p) => ['-i', p]);
    const filterInputs = audioPaths.map((_, i) => `[${i}:a]`).join('');
    const filter = `${filterInputs}concat=n=${audioPaths.length}:v=0:a=1[aout]`;
    run('ffmpeg', [
      '-y',
      ...inputArgs,
      '-filter_complex', filter,
      '-map', '[aout]',
      mergedAudioPath
    ]);
  }

  console.log('5/6 배경 이미지 생성 및 줌인 영상 렌더링 중...');
  const backgroundImagePath = path.join(BUILD_DIR, 'background.png');
  const backgroundImage = await generateBackgroundImage(latest.topic, latest.keyword);
  fs.writeFileSync(backgroundImagePath, backgroundImage);

  const backgroundVideoPath = path.join(BUILD_DIR, 'background.mp4');
  const totalFrames = Math.ceil(totalDuration * FPS);
  run('ffmpeg', [
    '-y',
    '-loop', '1',
    '-i', backgroundImagePath,
    '-t', totalDuration.toFixed(2),
    '-vf', `scale=${WIDTH}:${HEIGHT},zoompan=z='min(zoom+0.0006,1.4)':d=${totalFrames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`,
    '-r', String(FPS),
    '-pix_fmt', 'yuv420p',
    backgroundVideoPath
  ]);

  console.log('6/6 자막 생성 및 최종 합성 중...');
  const assPath = path.join(BUILD_DIR, 'subtitles.ass');
  fs.writeFileSync(assPath, buildAssSubtitles(timedSegments), 'utf8');

  const outputPath = path.join(OUTPUT_DIR, 'shorts.mp4');
  run('ffmpeg', [
    '-y',
    '-i', backgroundVideoPath,
    '-i', mergedAudioPath,
    '-vf', `ass=${assPath}`,
    '-map', '0:v',
    '-map', '1:a',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-shortest',
    '-pix_fmt', 'yuv420p',
    outputPath
  ]);

  const metaPath = path.join(OUTPUT_DIR, 'shorts.meta.json');
  fs.writeFileSync(metaPath, JSON.stringify({
    topic: latest.topic,
    tone: latest.tone,
    keyword: latest.keyword,
    duration: totalDuration,
    generatedAt: new Date().toISOString(),
    segments: timedSegments.map(({ label, start, duration }) => ({ label, start, duration }))
  }, null, 2) + '\n', 'utf8');

  console.log(`완료: ${outputPath}`);
}

main().catch((err) => {
  console.error('영상 생성 중 오류가 발생했습니다:', err);
  process.exit(1);
});
