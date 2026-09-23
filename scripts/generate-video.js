// Node script run by the "영상 제작" GitHub Actions workflow.
//
// Reads scripts/latest.json (produced by generate-script.js, and
// editable on the page before this runs via api/save-scenes.js). Each
// scene has its own narration (for TTS) and a short visual-mood
// description (used to pick a background color palette). For each scene
// this renders a fully standalone cut clip — its own background, audio,
// and burned-in subtitle — to output/cuts/, so cuts can be individually
// reviewed/re-cut in an external editor (e.g. CapCut). The final
// output/shorts.mp4 is just those cuts concatenated, so it already
// reflects whatever was last edited on the page.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { parseScriptSegments } = require('../lib/scriptSegments');
const { synthesizeSpeech } = require('../lib/tts');
const { generateSceneBackgroundImage, WIDTH, HEIGHT } = require('../lib/background');
const { generateSceneClip } = require('../lib/videoGen');
const { buildAssSubtitles, buildSceneCues } = require('../lib/subtitles');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const CUTS_DIR = path.join(OUTPUT_DIR, 'cuts');
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

function buildKlingPrompt(scene, topic) {
  const mood = scene.visual || topic || '추상적인 배경';
  return `${mood} 분위기의 추상적인 배경 영상. 부드럽고 느린 카메라 움직임, 텍스트 없음, 사람 얼굴 클로즈업 없음, 자연스럽게 반복 재생 가능한 루프 영상.`;
}

// Tries Kling AI for a short, on-theme animated clip and loops it with
// ffmpeg to fill the scene's actual (TTS-measured) duration — Kling only
// generates a few seconds per call, so looping keeps cost to exactly one
// Kling call per scene regardless of narration length. Falls back to the
// free gradient background (lib/background.js) if KLING_API_KEY isn't
// set, or if the Kling call fails for any reason (quota, content policy,
// timeout, etc.) so a flaky/unset video-gen provider never breaks the
// whole pipeline.
async function getSceneBackgroundVideo(scene, index, cutName, topic) {
  if (process.env.KLING_API_KEY) {
    try {
      const prompt = buildKlingPrompt(scene, topic);
      const externalTaskId = `shortapp-${Date.now()}-${index}`;
      console.log(`     Kling으로 배경 클립 생성 중 (task: ${externalTaskId})...`);
      const { buffer } = await generateSceneClip(prompt, externalTaskId);

      const rawClipPath = path.join(BUILD_DIR, `${cutName}-kling-raw.mp4`);
      fs.writeFileSync(rawClipPath, buffer);

      const loopedPath = path.join(BUILD_DIR, `${cutName}-bg.mp4`);
      run('ffmpeg', [
        '-y',
        '-stream_loop', '-1',
        '-i', rawClipPath,
        '-t', scene.duration.toFixed(2),
        '-vf', `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}`,
        '-r', String(FPS),
        '-pix_fmt', 'yuv420p',
        '-an',
        loopedPath
      ]);
      return loopedPath;
    } catch (err) {
      console.warn(`     Kling 생성 실패, 무료 그라데이션 배경으로 대체합니다: ${err.message}`);
    }
  }

  const backgroundImagePath = path.join(BUILD_DIR, `${cutName}-bg.png`);
  const backgroundImage = await generateSceneBackgroundImage(topic, scene.visual, index);
  fs.writeFileSync(backgroundImagePath, backgroundImage);

  const backgroundVideoPath = path.join(BUILD_DIR, `${cutName}-bg.mp4`);
  renderBackgroundVideo(backgroundImagePath, scene.duration, backgroundVideoPath);
  return backgroundVideoPath;
}

function loadScenes(latest) {
  if (Array.isArray(latest.scenes) && latest.scenes.length > 0) {
    return latest.scenes.map((s) => ({
      label: s.label,
      narration: s.narration || s.text || '',
      visual: s.visual || ''
    }));
  }
  // Fall back to parsing the flat script text (older latest.json files
  // generated before per-scene visual descriptions existed).
  if (!latest.script) {
    throw new Error('scripts/latest.json에 scenes도 script도 없습니다.');
  }
  return parseScriptSegments(latest.script).map((s) => ({
    label: s.label,
    narration: s.text,
    visual: ''
  }));
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

  console.log('1/5 장면 목록 불러오는 중...');
  const scenes = loadScenes(latest);
  console.log(`  -> ${scenes.length}개 장면: ${scenes.map((s) => s.label).join(', ')}`);

  console.log('2/5 장면별 음성 생성 중 (ElevenLabs)...');
  const audioPaths = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const audioBuffer = await synthesizeSpeech(scene.narration);
    const audioPath = path.join(BUILD_DIR, `scene-${i}.mp3`);
    fs.writeFileSync(audioPath, audioBuffer);
    audioPaths.push(audioPath);
    console.log(`  -> [${scene.label}] 생성 완료 (${audioBuffer.length} bytes)`);
  }

  console.log('3/5 길이 측정 중...');
  let cursor = 0;
  const timedScenes = scenes.map((scene, i) => {
    const duration = ffprobeDuration(audioPaths[i]);
    const timed = { ...scene, start: cursor, duration };
    cursor += duration;
    return timed;
  });
  const totalDuration = cursor;
  console.log(`  -> 총 길이: ${totalDuration.toFixed(2)}초`);

  console.log('4/5 장면별 클립 생성 중 (배경은 비주얼 묘사 기반)...');
  const cutFiles = [];
  const cutVideoPaths = [];
  for (let i = 0; i < timedScenes.length; i++) {
    const scene = timedScenes[i];
    const cutName = `cut-${String(i + 1).padStart(2, '0')}-${slugify(scene.label)}`;
    console.log(`  -> [${i + 1}/${timedScenes.length}] ${scene.label} (${scene.duration.toFixed(2)}초) — 비주얼: ${scene.visual || '(기본)'}`);

    const cutBackgroundVideoPath = await getSceneBackgroundVideo(scene, i, cutName, latest.topic);

    const cutAssPath = path.join(BUILD_DIR, `${cutName}.ass`);
    const sceneCues = buildSceneCues({ label: scene.label, text: scene.narration, start: 0, duration: scene.duration });
    fs.writeFileSync(cutAssPath, buildAssSubtitles(sceneCues), 'utf8');

    const cutVideoPath = path.join(CUTS_DIR, `${cutName}.mp4`);
    muxWithSubtitles(cutBackgroundVideoPath, audioPaths[i], cutAssPath, cutVideoPath);
    cutVideoPaths.push(cutVideoPath);

    const cutTextPath = path.join(CUTS_DIR, `${cutName}.txt`);
    fs.writeFileSync(cutTextPath, `${scene.label}\n\n${scene.narration}\n\n[비주얼: ${scene.visual || '(기본)'}]\n`, 'utf8');

    cutFiles.push({ label: scene.label, video: `cuts/${cutName}.mp4`, text: `cuts/${cutName}.txt` });
  }

  console.log('5/5 컷 이어붙여서 최종본 조립 중...');
  const concatListPath = path.join(BUILD_DIR, 'concat-list.txt');
  const concatList = cutVideoPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
  fs.writeFileSync(concatListPath, concatList, 'utf8');

  const outputPath = path.join(OUTPUT_DIR, 'shorts.mp4');
  run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', outputPath]);

  const metaPath = path.join(OUTPUT_DIR, 'shorts.meta.json');
  fs.writeFileSync(metaPath, JSON.stringify({
    topic: latest.topic,
    tone: latest.tone,
    keyword: latest.keyword,
    duration: totalDuration,
    generatedAt: new Date().toISOString(),
    scenes: timedScenes.map(({ label, start, duration, narration, visual }) => ({ label, start, duration, narration, visual })),
    cuts: cutFiles,
    finalVideo: 'shorts.mp4',
    note: 'shorts.mp4는 cuts/ 폴더의 개별 클립을 이어붙인 것입니다. 컷을 더 다듬고 싶으면 cuts/의 mp4를 CapCut 등으로 가져와 편집 후 새로 내보내세요.'
  }, null, 2) + '\n', 'utf8');

  console.log(`완료: ${outputPath} (컷 ${cutFiles.length}개는 ${CUTS_DIR}에 저장됨)`);
}

main().catch((err) => {
  console.error('영상 생성 중 오류가 발생했습니다:', err);
  process.exit(1);
});
