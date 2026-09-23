// Text-to-speech via ElevenLabs. Kept as a small, swappable module: a
// different provider only needs to implement synthesizeSpeech() with the
// same signature (text, options) -> Buffer of audio bytes.

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

// "Sarah" — confirmed present in this account's own Voices list (not
// pulled from the shared Voice Library), so it's usable via the API on
// the free plan. Voice IDs not already in the account's own voice list
// (e.g. Aria, Rachel) return 402 payment_required even if they appear
// in the "탐색"/Explore tab. Override with ELEVENLABS_VOICE_ID to use a
// different voice — check "내 음성" (My Voices) first to confirm it's
// actually in the account, not just the public library.
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';
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
