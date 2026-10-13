// Shared helper for calling the Claude API. Used by scripts/daily-pick.js
// (topic selection) and lib/dailyParagraph.js (paragraph generation).

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';

async function callClaude(prompt, apiKey) {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    const err = new Error(`Anthropic API error (${response.status}): ${errText}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  return (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

module.exports = { callClaude };
