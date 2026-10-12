// Generates a simple gradient title-card image for the intro/outro of a
// ranked-clips compilation video (the intro/outro narration has no source
// YouTube clip to show, unlike the 5 ranked items). Not meant to compete
// visually with the real clips — just a clean, cheap (free, no API call)
// backdrop with the item's role as big text.

const sharp = require('sharp');

const WIDTH = 1080;
const HEIGHT = 1920;

const PALETTES = {
  intro: ['#7c5cff', '#33e2c7'],
  outro: ['#ff5c7a', '#7c5cff']
};

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function generateTitleCardImage(kind, label) {
  const [from, to] = PALETTES[kind] || PALETTES.intro;
  const safeLabel = escapeXml(label || '');

  const svg = `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${from}" />
          <stop offset="100%" stop-color="${to}" />
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
        font-family="Noto Sans KR, sans-serif" font-size="110" font-weight="700"
        fill="#ffffff" opacity="0.92">${safeLabel}</text>
    </svg>
  `;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { generateTitleCardImage, WIDTH, HEIGHT };
