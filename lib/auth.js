// Minimal password-session auth for the serverless API. A logged-in
// session is a signed, time-limited token: `${expiresAt}.${hmac}`.
// Not a full auth system — this only exists to stop a random visitor
// from triggering GitHub Actions runs (which cost API credits) from the
// public static page.

const crypto = require('crypto');

const DEFAULT_TTL_SECONDS = 60 * 60 * 12; // 12 hours

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function createSessionToken(secret, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload, secret)}`;
}

function verifySessionToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return false;

  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;

  const expected = sign(payload, secret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && Date.now() <= expiresAt;
}

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { createSessionToken, verifySessionToken, constantTimeEqual };
