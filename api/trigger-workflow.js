// POST /api/trigger-workflow
// Body: { token, workflow: 'script'|'video', topic?, tone?, keyword?, duration? }
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
    if (body.topic) inputs.topic = String(body.topic).slice(0, 100);
    if (body.tone) inputs.tone = String(body.tone).slice(0, 100);
    if (body.keyword) inputs.keyword = String(body.keyword).slice(0, 100);
    if (body.duration) inputs.duration = String(body.duration).slice(0, 10);
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
