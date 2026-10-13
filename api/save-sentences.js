// POST /api/save-sentences
// Body: { items }
// items: [{ en, ko, audio, topic, date }]
//
// Persists the user's saved "good sentences" list (picked from the daily
// paragraph) to data/saved-sentences.json in the repo via the GitHub
// Contents API, so it survives a page refresh and is visible to anyone
// viewing the published site. Requires GITHUB_DISPATCH_TOKEN to have
// Contents: Read and write on the repo.
//
// No login/auth gate: anyone who can load the page can overwrite the
// saved list. Fine for personal/low-traffic use.

const { applyCors } = require('../lib/cors');

const FILE_PATH = 'data/saved-sentences.json';

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

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const items = Array.isArray(body.items) ? body.items : null;
  if (!items) {
    res.status(400).json({ error: 'items 배열이 필요합니다.' });
    return;
  }

  const cleanedItems = items.map((item) => ({
    en: String(item.en || '').slice(0, 500),
    ko: String(item.ko || '').slice(0, 500),
    audio: item.audio ? String(item.audio).slice(0, 300) : null,
    topic: item.topic ? String(item.topic).slice(0, 100) : null,
    date: item.date ? String(item.date).slice(0, 20) : null
  })).filter((item) => item.en);

  const updated = {
    updatedAt: new Date().toISOString(),
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
        message: 'chore: 저장된 문장 리스트 업데이트',
        content: contentBase64,
        sha,
        branch: ref
      })
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      console.error('save-sentences commit error:', putRes.status, errText);
      res.status(502).json({ error: 'GitHub에 저장하지 못했습니다. GITHUB_DISPATCH_TOKEN에 Contents 쓰기 권한이 있는지 확인하세요.' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('save-sentences error:', err);
    res.status(500).json({ error: '문장 저장 중 오류가 발생했습니다.' });
  }
};
