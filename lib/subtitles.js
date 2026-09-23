// Builds an .ass subtitle file from timed segments:
// [{ label, text, start, duration }, ...] (start/duration in seconds)
//
// One dialogue cue per segment, matching the validated prototype design
// (segment-level sync, not per-word). Long segment text is soft-wrapped
// so it doesn't overflow a 1080x1920 frame.

const WIDTH = 1080;
const HEIGHT = 1920;
const MAX_LINE_CHARS = 22;

function formatAssTime(seconds) {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.round((total - Math.floor(total)) * 100);
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

function wrapText(text, maxChars) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  return lines.join('\\N');
}

// Splits one scene's narration into ~2-line chunks (word-greedy, no
// per-word TTS timestamps available) and spreads them proportionally
// (by character count) across the scene's actual measured duration, so
// a long narration doesn't sit on screen as one giant subtitle block for
// its whole duration — instead a few words at a time advance roughly in
// step with the voiceover.
const CUE_MAX_CHARS = MAX_LINE_CHARS * 2;

function splitNarrationIntoCues(text, maxChars = CUE_MAX_CHARS) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const cues = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      cues.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) cues.push(current);

  return cues;
}

function buildSceneCues(scene) {
  const cueTexts = splitNarrationIntoCues(scene.text);
  const totalChars = cueTexts.reduce((sum, t) => sum + t.length, 0) || 1;

  let cursor = 0;
  return cueTexts.map((text) => {
    const duration = (text.length / totalChars) * scene.duration;
    const cue = { label: scene.label, text, start: scene.start + cursor, duration };
    cursor += duration;
    return cue;
  });
}

function buildAssSubtitles(segments) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${WIDTH}
PlayResY: ${HEIGHT}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans KR,66,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,1,0,0,0,100,100,0,0,1,4,2,2,80,80,220,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const lines = segments.map((seg) => {
    const start = formatAssTime(seg.start);
    const end = formatAssTime(seg.start + seg.duration);
    const text = wrapText(seg.text, MAX_LINE_CHARS);
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
  });

  return `${header}\n${lines.join('\n')}\n`;
}

module.exports = { buildAssSubtitles, formatAssTime, wrapText, splitNarrationIntoCues, buildSceneCues };
