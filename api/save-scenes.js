// POST /api/save-scenes
// Body: { token, topic, generatedAt, items }
//
// Persists edited narration (intro/rank items/outro, editable on the
// page before video generation runs) back to scripts/latest.json in the
// repo via the GitHub Contents API. Requires GITHUB_DISPATCH_TOKEN to
// have Contents: Read and write on the repo.

const { applyCors } = require('../lib/cors');
const { verifySessionToken } = require('../lib/auth');

const FILE_PATH = 'scripts/latest.json';

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

  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0) {
    res.status(400).json({ error: 'items 배열이 필요합니다.' });
    return;
  }

  const hasIntro = items.some((i) => i.type === 'intro');
  const hasOutro = items.some((i) => i.type === 'outro');
  const rankCount = items.filter((i) => i.type === 'rank').length;
  if (!hasIntro || !hasOutro || rankCount === 0) {
    res.status(400).json({ error: 'items에는 intro 1개, rank 1개 이상, outro 1개가 필요합니다.' });
    return;
  }

  const cleanedItems = items.map((item) => {
    const narration = String(item.narration || '').trim();
    if (item.type === 'rank') {
      return {
        type: 'rank',
        rank: Number(item.rank),
        videoId: String(item.videoId || ''),
        title: String(item.title || ''),
        channelTitle: String(item.channelTitle || ''),
        channelId: String(item.channelId || ''),
        url: String(item.url || ''),
        description: String(item.description || '').slice(0, 300),
        start: Number(item.start) || 0,
        end: Number(item.end) || 0,
        narration
      };
    }
    return { type: item.type, narration };
  });

  if (cleanedItems.some((item) => !item.narration)) {
    res.status(400).json({ error: '모든 항목의 내레이션은 비어 있을 수 없습니다.' });
    return;
  }

  const updated = {
    generatedAt: body.generatedAt || new Date().toISOString(),
    topic: body.topic || null,
    items: cleanedItems
  };

  const contentsUrl = `https://api.github.com/repos/${repo}/contents/${FILE_PATH}`;
  const githubHeaders = {
    Authorization: `Bearer ${githubToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  try {
    let sha;
    const getRes = await fetch(`${contentsUrl}?ref=${encodeURIComponent(ref)}`, { headers: githubHeaders });
    if (getRes.ok) {
      const getData = await getRes.json();
      sha = getData.sha;
    } else if (getRes.status !== 404) {
      res.status(502).json({ error: '기존 파일 조회에 실패했습니다.' });
      return;
    }

    const contentBase64 = Buffer.from(JSON.stringify(updated, null, 2) + '\n', 'utf8').toString('base64');

    const putRes = await fetch(contentsUrl, {
      method: 'PUT',
      headers: { ...githubHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'chore: 항목 편집 저장',
        content: contentBase64,
        sha,
        branch: ref
      })
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      console.error('save-scenes commit error:', putRes.status, errText);
      res.status(502).json({ error: 'GitHub에 저장하지 못했습니다. GITHUB_DISPATCH_TOKEN에 Contents 쓰기 권한이 있는지 확인하세요.' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('save-scenes error:', err);
    res.status(500).json({ error: '항목 저장 중 오류가 발생했습니다.' });
  }
};
