// POST /api/trigger-workflow
// Body: { token, workflow: 'script'|'video', topic?, selectedClips? }
//
// Dispatches the corresponding GitHub Actions workflow via the GitHub
// REST API, using a server-side GITHUB_DISPATCH_TOKEN. This is the piece
// that lets the static page's buttons actually kick off Actions runs
// without exposing that token to the browser.

const { applyCors } = require('../lib/cors');
const { verifySessionToken } = require('../lib/auth');

const WORKFLOW_FILES = {
  script: 'generate-script.yml',
  video: 'generate-video.yml'
};

const YOUTUBE_ID_RE = /^[\w-]{11}$/;
const RANK_COUNT = 5;
const MAX_CLIP_SECONDS = 60;

// Validates the 5 clips the user picked/ranked on the page before they
// get baked into a workflow_dispatch input string — this is the only
// server-side check standing between the browser and what yt-dlp/Claude
// actually see, so it's worth being strict here.
function validateSelectedClips(raw) {
  if (!Array.isArray(raw) || raw.length !== RANK_COUNT) {
    throw new Error(`클립은 정확히 ${RANK_COUNT}개 선택해야 합니다.`);
  }

  const seenRanks = new Set();
  const cleaned = raw.map((c) => {
    const rank = Number(c.rank);
    const videoId = String(c.videoId || '');
    const start = Number(c.start);
    const end = Number(c.end);

    if (!Number.isInteger(rank) || rank < 1 || rank > RANK_COUNT) {
      throw new Error('순위 값이 올바르지 않습니다.');
    }
    if (seenRanks.has(rank)) {
      throw new Error('중복된 순위가 있습니다.');
    }
    seenRanks.add(rank);

    if (!YOUTUBE_ID_RE.test(videoId)) {
      throw new Error('영상 ID가 올바르지 않습니다.');
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > MAX_CLIP_SECONDS) {
      throw new Error(`클립 구간이 올바르지 않습니다 (0초 이상, 최대 ${MAX_CLIP_SECONDS}초).`);
    }

    return {
      rank,
      videoId,
      title: String(c.title || '').slice(0, 150),
      channelTitle: String(c.channelTitle || '').slice(0, 100),
      channelId: String(c.channelId || '').slice(0, 50),
      url: String(c.url || `https://www.youtube.com/watch?v=${videoId}`).slice(0, 200),
      description: String(c.description || '').slice(0, 300),
      start,
      end
    };
  });

  if (seenRanks.size !== RANK_COUNT) {
    throw new Error('순위는 1~5가 각각 한 번씩 있어야 합니다.');
  }

  return cleaned;
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }

  const authSecret = process.env.AUTH_SECRET;
  const githubToken = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO || 'boryeong26/shortapp';
  const ref = process.env.GITHUB_REF || 'main';

  if (!authSecret || !githubToken) {
    res.status(500).json({ error: '서버에 AUTH_SECRET/GITHUB_DISPATCH_TOKEN이 설정되어 있지 않습니다.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  if (!verifySessionToken(body.token, authSecret)) {
    res.status(401).json({ error: '로그인이 만료되었거나 유효하지 않습니다. 다시 로그인해주세요.' });
    return;
  }

  const workflowFile = WORKFLOW_FILES[body.workflow];
  if (!workflowFile) {
    res.status(400).json({ error: '알 수 없는 워크플로우입니다.' });
    return;
  }

  const inputs = {};
  if (body.workflow === 'script') {
    inputs.topic = String(body.topic || '순위 모음').slice(0, 100);
    try {
      inputs.selectedClips = JSON.stringify(validateSelectedClips(body.selectedClips));
    } catch (err) {
      res.status(400).json({ error: err.message });
      return;
    }
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({ ref, inputs })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('GitHub dispatch error:', response.status, errText);
      res.status(502).json({ error: 'GitHub 워크플로우 실행 요청이 실패했습니다.' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('trigger-workflow error:', err);
    res.status(500).json({ error: '워크플로우 실행 중 오류가 발생했습니다.' });
  }
};
