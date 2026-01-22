const endpoint = process.env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, '');
const apiKey = process.env.AZURE_OPENAI_API_KEY;
const deployment = 'gpt-5-mini';
const apiVersion = '2024-12-01-preview';

const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

console.log('Testing GPT-5 Mini...');
console.log('URL:', url.replace(apiKey, '***'));

fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'api-key': apiKey,
  },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Say hello in exactly 3 words.' }],
    temperature: 0.7,
    max_completion_tokens: 100,
  }),
})
.then(r => r.json())
.then(data => {
  if (data.error) {
    console.log('ERROR:', JSON.stringify(data.error, null, 2));
  } else {
    console.log('SUCCESS!');
    console.log('Response:', data.choices?.[0]?.message?.content);
    console.log('Tokens - Input:', data.usage?.prompt_tokens, '| Output:', data.usage?.completion_tokens);
  }
})
.catch(e => console.log('FETCH ERROR:', e.message));
