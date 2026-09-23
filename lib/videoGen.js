// Text-to-video via Kling AI (kling-o1 model). Kling only generates short
// clips (a few seconds) per call — see generate-video.js for how the
// resulting clip is looped with ffmpeg to cover a scene's full narration
// length, which keeps the number of (paid) Kling calls fixed at one per
// scene regardless of how long that scene's narration runs.
//
// Docs confirmed directly against the account's own KlingAI Open
// Platform pages (kling.ai/document/api):
// - Auth: `Authorization: Bearer <KLING_API_KEY>`
// - Create: POST https://api-singapore.klingai.com/omni-video/kling-o1
// - Poll:   GET  https://api-singapore.klingai.com/tasks?external_task_ids={id}

const KLING_BASE_URL = 'https://api-singapore.klingai.com';
// Seconds per individual Kling clip. generate-video.js requests enough of
// these back-to-back to cover a scene's full duration without looping —
// see getSceneBackgroundVideo() there.
const DEFAULT_CLIP_DURATION = 5;

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
}

async function createVideoTask(prompt, externalTaskId, options = {}) {
  const apiKey = options.apiKey || process.env.KLING_API_KEY;
  if (!apiKey) {
    throw new Error('KLING_API_KEY 환경변수가 설정되어 있지 않습니다.');
  }

  const duration = options.duration || Number(process.env.KLING_CLIP_DURATION) || DEFAULT_CLIP_DURATION;

  const response = await fetch(`${KLING_BASE_URL}/omni-video/kling-o1`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      contents: [{ type: 'prompt', text: prompt }],
      settings: {
        resolution: '1080p',
        aspect_ratio: '9:16',
        duration,
        audio: 'off'
      },
      options: {
        external_task_id: externalTaskId
      }
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data || data.code !== 0) {
    const err = new Error(`Kling 작업 생성 실패: ${data ? data.message : response.statusText}`);
    err.status = response.status;
    throw err;
  }

  return { externalTaskId };
}

async function pollVideoTask(externalTaskId, options = {}) {
  const apiKey = options.apiKey || process.env.KLING_API_KEY;
  const maxAttempts = options.maxAttempts || 30; // ~5 minutes at 10s interval
  const intervalMs = options.intervalMs || 10000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(
      `${KLING_BASE_URL}/tasks?external_task_ids=${encodeURIComponent(externalTaskId)}`,
      { headers: authHeaders(apiKey) }
    );
    const data = await response.json().catch(() => null);

    if (!response.ok || !data || data.code !== 0) {
      throw new Error(`Kling 작업 조회 실패: ${data ? data.message : response.statusText}`);
    }

    const task = (data.data || [])[0];
    if (!task) {
      throw new Error(`external_task_id=${externalTaskId}에 해당하는 작업을 찾지 못했습니다.`);
    }

    if (task.status === 'succeeded') {
      const videoOutput = (task.outputs || []).find((o) => o.type === 'video');
      if (!videoOutput || !videoOutput.url) {
        throw new Error('Kling 작업이 성공했지만 결과 영상 URL을 찾지 못했습니다.');
      }
      return { url: videoOutput.url, duration: Number(videoOutput.duration) || null };
    }

    if (task.status === 'failed') {
      throw new Error(`Kling 영상 생성 실패: ${task.message || '알 수 없는 오류'}`);
    }

    // submitted | processing -> keep waiting
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('Kling 영상 생성 대기 시간이 초과되었습니다.');
}

async function downloadVideo(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Kling 결과 영상 다운로드 실패 (HTTP ${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Generates one short clip for a scene and waits for it to finish.
// externalTaskId should be unique per attempt (Kling dedupes by it).
async function generateSceneClip(prompt, externalTaskId, options = {}) {
  await createVideoTask(prompt, externalTaskId, options);
  const result = await pollVideoTask(externalTaskId, options);
  const buffer = await downloadVideo(result.url);
  return { buffer, duration: result.duration };
}

module.exports = {
  KLING_BASE_URL,
  DEFAULT_CLIP_DURATION,
  createVideoTask,
  pollVideoTask,
  downloadVideo,
  generateSceneClip
};
