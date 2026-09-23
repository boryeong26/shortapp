// POST /api/login
// Body: { password: string } -> { token: string } | { error: string }
//
// Issues a signed, time-limited session token if the password matches
// APP_PASSWORD. The token (not the password) is what the page then sends
// to /api/trigger-workflow and /api/workflow-status.

const { applyCors } = require('../lib/cors');
const { createSessionToken, constantTimeEqual } = require('../lib/auth');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 지원합니다.' });
    return;
  }

  const appPassword = process.env.APP_PASSWORD;
  const authSecret = process.env.AUTH_SECRET;
  if (!appPassword || !authSecret) {
    res.status(500).json({ error: '서버에 APP_PASSWORD/AUTH_SECRET이 설정되어 있지 않습니다.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const password = typeof body.password === 'string' ? body.password : '';

  if (!password || !constantTimeEqual(password, appPassword)) {
    res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
    return;
  }

  const token = createSessionToken(authSecret);
  res.status(200).json({ token });
};
