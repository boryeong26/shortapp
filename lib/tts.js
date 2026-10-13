// Text-to-speech via ElevenLabs, used to generate the audio for the
// daily English practice paragraph. Not a public-facing endpoint — only
// called from scripts/daily-pick.js inside the GitHub Actions workflow.

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
// "Sarah" — confirmed working on this project's ElevenLabs account
// (library/shared voices return 402 on the free tier; this one is
// actually owned by the account).
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';
const MODEL_ID = 'eleven_multilingual_v2';

async function synthesizeSpeech(text, options = {}) {
  const apiKey = options.apiKey || process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY 환경변수가 설정되어 있지 않습니다.');
  }
  const voiceId = options.voiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;

  const response = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg'
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID
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

module.exports = { synthesizeSpeech, DEFAULT_VOICE_ID };
