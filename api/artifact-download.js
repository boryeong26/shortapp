// GET /api/artifact-download?token=...&workflow=script|video
//
// Finds the latest successful run of the given workflow and returns a
// short-lived download URL for its uploaded artifact zip, so the page
// can offer a direct "다운로드" button instead of sending the user to
// the Actions tab to find and download it manually.

const { applyCors } = require('../lib/cors');
const { verifySessionToken } = require('../lib/auth');

const WORKFLOW_FILES = {
  script: 'generate-script.yml',
  video: 'generate-video.yml'
};

const GITHUB_API_HEADERS = (githubToken) => ({
  Authorization: `Bearer ${githubToken}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
});

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET 요청만 지원합니다.' });
    return;
  }

  const authSecret = process.env.AUTH_SECRET;
  const githubToken = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO || 'boryeong26/shortapp';

  if (!authSecret || !githubToken) {
    res.status(500).json({ error: '서버에 AUTH_SECRET/GITHUB_DISPATCH_TOKEN이 설정되어 있지 않습니다.' });
    return;
  }

  const query = req.query || {};
  const token = Array.isArray(query.token) ? query.token[0] : query.token;
  const workflowKey = Array.isArray(query.workflow) ? query.workflow[0] : query.workflow;

  if (!verifySessionToken(token, authSecret)) {
    res.status(401).json({ error: '로그인이 만료되었거나 유효하지 않습니다. 다시 로그인해주세요.' });
    return;
  }

  const workflowFile = WORKFLOW_FILES[workflowKey];
  if (!workflowFile) {
    res.status(400).json({ error: '알 수 없는 워크플로우입니다.' });
    return;
  }

  try {
    const runsRes = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/runs?status=success&per_page=1`,
      { headers: GITHUB_API_HEADERS(githubToken) }
    );
    if (!runsRes.ok) {
      res.status(502).json({ error: 'GitHub 실행 목록 조회가 실패했습니다.' });
      return;
    }
    const runsData = await runsRes.json();
    const run = (runsData.workflow_runs || [])[0];
    if (!run) {
      res.status(404).json({ error: '성공한 실행 기록이 없습니다.' });
      return;
    }

    const artifactsRes = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs/${run.id}/artifacts`,
      { headers: GITHUB_API_HEADERS(githubToken) }
    );
    if (!artifactsRes.ok) {
      res.status(502).json({ error: 'GitHub 아티팩트 목록 조회가 실패했습니다.' });
      return;
    }
    const artifactsData = await artifactsRes.json();
    const artifact = (artifactsData.artifacts || [])[0];
    if (!artifact) {
      res.status(404).json({ error: '이 실행에는 업로드된 아티팩트가 없습니다.' });
      return;
    }
    if (artifact.expired) {
      res.status(410).json({ error: '아티팩트 보관 기간이 만료되었습니다.' });
      return;
    }

    const downloadRes = await fetch(
      `https://api.github.com/repos/${repo}/actions/artifacts/${artifact.id}/zip`,
      { headers: GITHUB_API_HEADERS(githubToken), redirect: 'manual' }
    );

    const location = downloadRes.headers.get('location');
    if (!location) {
      res.status(502).json({ error: '다운로드 URL을 가져오지 못했습니다.' });
      return;
    }

    res.status(200).json({
      downloadUrl: location,
      name: artifact.name,
      sizeInBytes: artifact.size_in_bytes,
      runUrl: run.html_url
    });
  } catch (err) {
    console.error('artifact-download error:', err);
    res.status(500).json({ error: '아티팩트 조회 중 오류가 발생했습니다.' });
  }
};
