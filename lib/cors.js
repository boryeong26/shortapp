// The static page (GitHub Pages, e.g. boryeong26.github.io) and the API
// (Vercel, a different origin) live on different domains, so every
// endpoint needs CORS headers. Set CORS_ORIGIN in the deployment env to
// lock this down to your actual Pages URL; defaults to "*" so the first
// deploy works without extra config.

function applyCors(req, res) {
  const allowedOrigin = process.env.CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

module.exports = { applyCors };
