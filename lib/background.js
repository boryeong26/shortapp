// Generates a 1080x1920 radial-gradient background image for a topic,
// as an SVG rasterized to PNG via sharp. No native build deps (unlike
// node-canvas), which keeps GitHub Actions setup to a plain `npm install`.
//
// Designed to be swapped out later: generateBackgroundImage() just needs
// to keep returning a PNG Buffer at the given width/height. A future
// AI-image or stock-photo provider can implement the same signature.

const sharp = require('sharp');

const WIDTH = 1080;
const HEIGHT = 1920;

// Topic -> { base (deep background), mid, glow (event-horizon/accent ring) }
const PALETTES = {
  '블랙홀': { base: '#02030a', mid: '#0d0a2b', glow: '#33e2c7' },
  '우주': { base: '#03040f', mid: '#0b1240', glow: '#7c5cff' },
  '물리학': { base: '#04070f', mid: '#0a1a3a', glow: '#4fd7ff' },
  '생물학': { base: '#03100a', mid: '#0a2e1c', glow: '#3ee6a0' },
  '화학': { base: '#100a03', mid: '#3a1e0a', glow: '#ff9d4d' },
  '뇌과학': { base: '#0a030f', mid: '#2a0a3a', glow: '#e05cff' },
  '인체': { base: '#100308', mid: '#3a0a1c', glow: '#ff5c7a' },
  '기후/지구과학': { base: '#03100d', mid: '#0a3a2e', glow: '#33e2c7' },
  '테크놀로지': { base: '#03060f', mid: '#0a1a3a', glow: '#7c5cff' }
};

const DEFAULT_PALETTE = { base: '#05060a', mid: '#12162a', glow: '#7c5cff' };

// Small deterministic PRNG so the same topic renders a consistent star field.
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getPalette(topic) {
  return PALETTES[topic] || DEFAULT_PALETTE;
}

function buildStarsMarkup(random, count) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    const x = Math.round(random() * WIDTH);
    const y = Math.round(random() * HEIGHT);
    const r = (random() * 1.6 + 0.4).toFixed(2);
    const opacity = (random() * 0.6 + 0.3).toFixed(2);
    stars.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" opacity="${opacity}" />`);
  }
  return stars.join('\n    ');
}

function buildSvg(topic, keyword) {
  const palette = getPalette(topic);
  const seed = hashSeed(`${topic}:${keyword || ''}`);
  const random = mulberry32(seed);
  const stars = buildStarsMarkup(random, 140);
  const cx = WIDTH / 2;
  const cy = HEIGHT * 0.42;

  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="75%">
      <stop offset="0%" stop-color="${palette.mid}" />
      <stop offset="55%" stop-color="${palette.base}" />
      <stop offset="100%" stop-color="#000000" />
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${palette.glow}" stop-opacity="0.85" />
      <stop offset="35%" stop-color="${palette.glow}" stop-opacity="0.25" />
      <stop offset="100%" stop-color="${palette.glow}" stop-opacity="0" />
    </radialGradient>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="40" />
    </filter>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />

  <g>
    ${stars}
  </g>

  <circle cx="${cx}" cy="${cy}" r="360" fill="url(#glow)" filter="url(#blur)" />
  <circle cx="${cx}" cy="${cy}" r="150" fill="${palette.base}" opacity="0.9" />
  <circle cx="${cx}" cy="${cy}" r="150" fill="none" stroke="${palette.glow}" stroke-width="6" opacity="0.6" filter="url(#blur)" />
</svg>`;
}

async function generateBackgroundImage(topic, keyword) {
  const svg = buildSvg(topic, keyword);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { generateBackgroundImage, getPalette, WIDTH, HEIGHT };
