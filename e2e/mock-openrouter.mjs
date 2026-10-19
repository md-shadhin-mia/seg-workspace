// A tiny stand-in for OpenRouter's /chat/completions, so e2e tests never call a real model.
// It answers project-plan requests with a plan built from the team members in the prompt,
// and records every request at GET /__requests so tests can check what was sent.
import http from 'node:http';

const port = Number(process.env.MOCK_PORT ?? 3199);
const KEY = 'sk-or-e2e';
const requests = [];

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

function plan(prompt) {
  const today = /Today: (\d{4}-\d{2}-\d{2})/.exec(prompt)?.[1] ?? new Date().toISOString().slice(0, 10);
  const members = [...prompt.matchAll(/id: ([0-9a-f-]{36}) \| ([^|\n]+)/g)].map((m) => ({ id: m[1], name: m[2].trim() }));
  return {
    description: 'A landing page for spring admissions that collects enquiries.',
    objectives: ['Collect enquiries for the spring intake', 'Launch before the fair'],
    milestones: [{ title: 'Design approved', dueDate: addDays(today, 7) }],
    tasks: [
      { title: 'Design the landing page hero', description: 'Desktop and mobile hero with the intake dates.', priority: 'high', assigneeId: members[0]?.id ?? null, dueDate: addDays(today, 5) },
      { title: 'Build the enquiry form', description: 'Form that emails admissions.', priority: 'medium', assigneeId: 'someone-not-in-the-team', dueDate: addDays(today, 10) },
      { title: 'Write the page copy', description: 'Headline, benefits and FAQ.', priority: 'low', assigneeId: null, dueDate: '2001-01-01' },
    ],
    risks: ['Intake dates may change'],
  };
}

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
  if (req.method === 'GET' && req.url === '/__requests') return send(res, 200, requests);
  if (req.method !== 'POST' || req.url !== '/api/v1/chat/completions') return send(res, 404, { error: { code: 404, message: 'Not found' } });
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    requests.push({ headers: { 'x-title': req.headers['x-title'], 'http-referer': req.headers['http-referer'] }, body });
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(res, 401, { error: { code: 401, message: 'No auth credentials found' } });
    const prompt = (body.messages ?? []).map((m) => m.content).join('\n');
    const json = body.response_format?.type === 'json_object';
    const content = json && /project plan/i.test(prompt) ? '```json\n' + JSON.stringify(plan(prompt)) + '\n```'
      : json ? JSON.stringify({ items: ['Collect the brand assets', 'Draft the first version', 'Share it for review'] })
      : '- Mock answer from the e2e OpenRouter stand-in.';
    send(res, 200, {
      id: 'gen-e2e', model: body.model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
      usage: { prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: Math.ceil(content.length / 4) },
    });
  });
}).listen(port, () => console.log(`mock OpenRouter on :${port}`));
