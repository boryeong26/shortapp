// Node script run by the "영상 제작" GitHub Actions workflow.
//
// Reads scripts/latest.json (produced by generate-script.js, and
// editable on the page before this runs via api/save-scenes.js): an
// intro, 5 ranked items each tied to a real Creative Commons-licensed
// YouTube clip (videoId + start/end trim range) chosen on the page, and
// an outro. For each item this downloads/trims the real clip (yt-dlp),
// synthesizes narration (ElevenLabs), burns subtitles, and renders a
// standalone cut to output/cuts/ so cuts can be individually reviewed or
// re-cut in an external editor. The final output/shorts.mp4 is just
// those cuts concatenated. output/credits.txt lists the required CC BY
// attribution for every source clip used — paste it into the YouTube
// description before publishing.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { synthesizeSpeech } = require('../lib/tts');
const { generateTitleCardImage } = require('../lib/titleCard');
const { buildAssSubtitles, buildSceneCues } = require('../lib/subtitles');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const CUTS_DIR = path.join(OUTPUT_DIR, 'cuts');
const WIDTH = 1080;
const HEIGHT = 1920;
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

function slugify(label) {
  return label.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
}

function renderBackgroundVideo(backgroundImagePath, durationSeconds, outputPath) {
  const totalFrames = Math.ceil(durationSeconds * FPS);
  run('ffmpeg', [
    '-y',
    '-loop', '1',
    '-i', backgroundImagePath,
    '-t', durationSeconds.toFixed(2),
    '-vf', `scale=${WIDTH}:${HEIGHT},zoompan=z='min(zoom+0.0006,1.4)':d=${totalFrames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`,
    '-r', String(FPS),
    '-pix_fmt', 'yuv420p',
    outputPath
  ]);
}

function muxWithSubtitles(backgroundVideoPath, audioPath, assPath, outputPath) {
  run('ffmpeg', [
    '-y',
    '-i', backgroundVideoPath,
    '-i', audioPath,
    '-vf', `ass=${assPath}`,
    '-map', '0:v',
    '-map', '1:a',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-shortest',
    '-pix_fmt', 'yuv420p',
    outputPath
  ]);
}

// Downloads just the [start, end) seconds of a YouTube video (not the
// whole thing) via yt-dlp's --download-sections, since that's all a
// given rank item needs.
function downloadYoutubeClip(videoId, start, end, outPath) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  run('yt-dlp', [
    '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b',
    '--download-sections', `*${start}-${end}`,
    '--force-keyframes-at-cuts',
    '--merge-output-format', 'mp4',
    '-o', outPath,
    url
  ]);
}

// Scales/crops a raw clip to the 1080x1920 output frame and strips audio
// (narration replaces it entirely). If the user's trimmed clip is shorter
// than the scene's TTS-measured narration, loops it so the background
// never runs out before the voiceover does — muxWithSubtitles' -shortest
// trims any extra length back down to the audio's length afterward.
function normalizeClip(rawPath, targetDurationSeconds, outPath) {
  const rawDuration = ffprobeDuration(rawPath);
  const args = ['-y'];
  if (rawDuration < targetDurationSeconds) {
    args.push('-stream_loop', '-1');
  }
  args.push(
    '-i', rawPath,
    '-t', targetDurationSeconds.toFixed(2),
    '-vf', `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}`,
    '-r', String(FPS),
    '-pix_fmt', 'yuv420p',
    '-an',
    outPath
  );
  run('ffmpeg', args);
}

async function getRankClipBackground(item, cutName, targetDuration) {
  const rawPath = path.join(BUILD_DIR, `${cutName}-raw.mp4`);
  downloadYoutubeClip(item.videoId, item.start, item.end, rawPath);

  const normalizedPath = path.join(BUILD_DIR, `${cutName}-bg.mp4`);
  normalizeClip(rawPath, targetDuration, normalizedPath);
  return normalizedPath;
}

async function getTitleCardBackground(kind, label, cutName, targetDuration) {
  const imagePath = path.join(BUILD_DIR, `${cutName}-bg.png`);
  const image = await generateTitleCardImage(kind, label);
  fs.writeFileSync(imagePath, image);

  const videoPath = path.join(BUILD_DIR, `${cutName}-bg-card.mp4`);
  renderBackgroundVideo(imagePath, targetDuration, videoPath);
  return videoPath;
}

function cueLabel(item) {
  if (item.type === 'intro') return '인트로';
  if (item.type === 'outro') return '아웃트로';
  return `${item.rank}위`;
}

function loadItems(latest) {
  const items = Array.isArray(latest.items) ? latest.items : null;
  if (!items || items.length === 0) {
    throw new Error('scripts/latest.json에 items가 없습니다.');
  }
  const hasIntro = items.some((i) => i.type === 'intro');
  const hasOutro = items.some((i) => i.type === 'outro');
  const rankCount = items.filter((i) => i.type === 'rank').length;
  if (!hasIntro || !hasOutro || rankCount === 0) {
    throw new Error('items에는 intro 1개, rank 1개 이상, outro 1개가 필요합니다.');
  }
  return items;
}

async function main() {
  const latestPath = path.join(__dirname, 'latest.json');
  if (!fs.existsSync(latestPath)) {
    console.error('scripts/latest.json이 없습니다. 먼저 대본 생성 워크플로우를 실행하세요.');
    process.exit(1);
  }

  const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(CUTS_DIR, { recursive: true });

  console.log('1/5 항목 목록 불러오는 중...');
  const items = loadItems(latest);
  console.log(`  -> ${items.length}개 항목: ${items.map(cueLabel).join(', ')}`);

  console.log('2/5 항목별 음성 생성 중 (ElevenLabs)...');
  const audioPaths = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const audioBuffer = await synthesizeSpeech(item.narration);
    const audioPath = path.join(BUILD_DIR, `item-${i}.mp3`);
    fs.writeFileSync(audioPath, audioBuffer);
    audioPaths.push(audioPath);
    console.log(`  -> [${cueLabel(item)}] 생성 완료 (${audioBuffer.length} bytes)`);
  }

  console.log('3/5 길이 측정 중...');
  let cursor = 0;
  const timedItems = items.map((item, i) => {
    const duration = ffprobeDuration(audioPaths[i]);
    const timed = { ...item, start: cursor, duration };
    cursor += duration;
    return timed;
  });
  const totalDuration = cursor;
  console.log(`  -> 총 길이: ${totalDuration.toFixed(2)}초`);

  console.log('4/5 항목별 클립 생성 중 (순위 항목은 실제 유튜브 클립 다운로드)...');
  const cutFiles = [];
  const cutVideoPaths = [];
  const creditLines = [];

  for (let i = 0; i < timedItems.length; i++) {
    const item = timedItems[i];
    const label = cueLabel(item);
    const cutName = `cut-${String(i + 1).padStart(2, '0')}-${slugify(label)}`;
    console.log(`  -> [${i + 1}/${timedItems.length}] ${label} (${item.duration.toFixed(2)}초)`);

    let backgroundPath;
    if (item.type === 'rank') {
      backgroundPath = await getRankClipBackground(item, cutName, item.duration);
      creditLines.push(`${item.rank}위: "${item.title}" - ${item.channelTitle} (${item.url}) - CC BY (https://creativecommons.org/licenses/by/4.0/legalcode)`);
    } else {
      backgroundPath = await getTitleCardBackground(item.type, latest.topic || '', cutName, item.duration);
    }

    const cutAssPath = path.join(BUILD_DIR, `${cutName}.ass`);
    const sceneCues = buildSceneCues({ label, text: item.narration, start: 0, duration: item.duration });
    fs.writeFileSync(cutAssPath, buildAssSubtitles(sceneCues), 'utf8');

    const cutVideoPath = path.join(CUTS_DIR, `${cutName}.mp4`);
    muxWithSubtitles(backgroundPath, audioPaths[i], cutAssPath, cutVideoPath);
    cutVideoPaths.push(cutVideoPath);

    const cutTextPath = path.join(CUTS_DIR, `${cutName}.txt`);
    const sourceLine = item.type === 'rank' ? `\n[출처: ${item.title} - ${item.channelTitle} (${item.url})]\n` : '';
    fs.writeFileSync(cutTextPath, `${label}\n\n${item.narration}\n${sourceLine}`, 'utf8');

    cutFiles.push({ label, video: `cuts/${cutName}.mp4`, text: `cuts/${cutName}.txt` });
  }

  console.log('5/5 컷 이어붙여서 최종본 조립 중...');
  const concatListPath = path.join(BUILD_DIR, 'concat-list.txt');
  const concatList = cutVideoPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
  fs.writeFileSync(concatListPath, concatList, 'utf8');

  const outputPath = path.join(OUTPUT_DIR, 'shorts.mp4');
  run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', outputPath]);

  const creditsPath = path.join(OUTPUT_DIR, 'credits.txt');
  fs.writeFileSync(
    creditsPath,
    `이 영상은 아래 Creative Commons(CC BY) 라이선스 영상을 사용했습니다. 업로드 전 설명란에 아래 내용을 붙여넣으세요:\n\n${creditLines.join('\n')}\n`,
    'utf8'
  );

  const metaPath = path.join(OUTPUT_DIR, 'shorts.meta.json');
  fs.writeFileSync(metaPath, JSON.stringify({
    topic: latest.topic,
    duration: totalDuration,
    generatedAt: new Date().toISOString(),
    items: timedItems.map(({ type, rank, title, channelTitle, url, start, duration, narration }) =>
      ({ type, rank, title, channelTitle, url, start, duration, narration })),
    cuts: cutFiles,
    finalVideo: 'shorts.mp4',
    credits: 'credits.txt',
    note: 'shorts.mp4는 cuts/ 폴더의 개별 클립을 이어붙인 것입니다. 업로드 전 credits.txt의 출처 표기를 설명란에 반드시 포함하세요 (CC BY 라이선스 조건).'
  }, null, 2) + '\n', 'utf8');

  console.log(`완료: ${outputPath} (컷 ${cutFiles.length}개는 ${CUTS_DIR}에 저장됨, 출처는 ${creditsPath} 참고)`);
}

main().catch((err) => {
  console.error('영상 생성 중 오류가 발생했습니다:', err);
  process.exit(1);
});
