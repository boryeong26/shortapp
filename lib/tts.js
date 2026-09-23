// Text-to-speech via ElevenLabs. Kept as a small, swappable module: a
// different provider only needs to implement synthesizeSpeech() with the
// same signature (text, options) -> Buffer of audio bytes.

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

// "Aria" — a default multilingual ElevenLabs voice that handles Korean well.
// Override with the ELEVENLABS_VOICE_ID env var to use a different voice.
const DEFAULT_VOICE_ID = '9BWtsMINqrJLrRacOk9x';
const DEFAULT_MODEL_ID = 'eleven_multilingual_v2';

async function synthesizeSpeech(text, options = {}) {
  const apiKey = options.apiKey || process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY 환경변수가 설정되어 있지 않습니다.');
  }

  const voiceId = options.voiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const modelId = options.modelId || DEFAULT_MODEL_ID;

  const response = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
      'xi-api-key': apiKey
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    const err = new Error(`ElevenLabs API error (${response.status}): ${errText}`);
    err.status = response.status;
    throw err;
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { synthesizeSpeech, DEFAULT_VOICE_ID, DEFAULT_MODEL_ID };
