// GET /api/workflow-status?token=...&workflow=script|video
//
// Returns the most recent run's status for the given workflow, so the
// page can show "실행 중..." / "완료" after the user clicks a trigger
// button instead of leaving them to go check the Actions tab manually.

const { applyCors } = require('../lib/cors');
const { verifySessionToken } = require('../lib/auth');

const WORKFLOW_FILES = {
  script: 'generate-script.yml',
  video: 'generate-video.yml'
};

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
    const response = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/runs?per_page=1`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }
    );

    if (!response.ok) {
      res.status(502).json({ error: 'GitHub 상태 조회가 실패했습니다.' });
      return;
    }

    const data = await response.json();
    const run = (data.workflow_runs || [])[0];

    if (!run) {
      res.status(200).json({ status: 'none' });
      return;
    }

    res.status(200).json({
      status: run.status, // queued | in_progress | completed
      conclusion: run.conclusion, // success | failure | cancelled | null
      htmlUrl: run.html_url,
      createdAt: run.created_at,
      updatedAt: run.updated_at
    });
  } catch (err) {
    console.error('workflow-status error:', err);
    res.status(500).json({ error: '상태 조회 중 오류가 발생했습니다.' });
  }
};
