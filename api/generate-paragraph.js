// POST /api/generate-paragraph
//
// Manually triggers the "오늘의 영어 한 단락" GitHub Actions workflow
// (.github/workflows/daily-pick.yml) instead of it running on a fixed
// daily schedule. Enforces "once per day" server-side by checking the
// `date` field already committed in data/daily-paragraph.json before
// dispatching — if it already matches today's date, the request is
// rejected instead of kicking off another (costly) generation run.
//
// Requires GITHUB_DISPATCH_TOKEN to additionally have Actions: write
// permission on the repo (a classic PAT with "repo" scope already has
// this; a fine-grained PAT needs the "Actions" permission added).
//
// No login/auth gate: anyone who can load the page can trigger this,
// but the once-per-day check keeps repeated clicks from burning
// Claude/ElevenLabs quota.

const { applyCors } = require('../lib/cors');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }

  const githubToken = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO || 'boryeong26/shortapp';
  const ref = process.env.GITHUB_REF || 'main';

  if (!githubToken) {
    res.status(500).json({ error: '서버에 GITHUB_DISPATCH_TOKEN이 설정되어 있지 않습니다.' });
    return;
  }

  const githubHeaders = {
    Authorization: `Bearer ${githubToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  try {
    const today = new Date().toISOString().slice(0, 10);

    const contentsUrl = `https://api.github.com/repos/${repo}/contents/data/daily-paragraph.json?ref=${encodeURIComponent(ref)}`;
    const getRes = await fetch(contentsUrl, { headers: githubHeaders });
    if (getRes.ok) {
      const getData = await getRes.json();
      const current = JSON.parse(Buffer.from(getData.content, 'base64').toString('utf8'));
      if (current.date === today) {
        res.status(429).json({ error: '오늘은 이미 생성했습니다. 내일 다시 시도해주세요.' });
        return;
      }
    } else if (getRes.status !== 404) {
      res.status(502).json({ error: '기존 단락 조회에 실패했습니다.' });
      return;
    }

    const dispatchUrl = `https://api.github.com/repos/${repo}/actions/workflows/daily-pick.yml/dispatches`;
    const dispatchRes = await fetch(dispatchUrl, {
      method: 'POST',
      headers: { ...githubHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref })
    });

    if (!dispatchRes.ok) {
      const errText = await dispatchRes.text();
      console.error('generate-paragraph dispatch error:', dispatchRes.status, errText);
      res.status(502).json({ error: '생성 작업을 시작하지 못했습니다. GITHUB_DISPATCH_TOKEN에 Actions 쓰기 권한이 있는지 확인하세요.' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('generate-paragraph error:', err);
    res.status(500).json({ error: '생성 요청 중 오류가 발생했습니다.' });
  }
};
