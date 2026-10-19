import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createOpenRouter, data, parseJson } from '../src/lib/ai.js';

const cfg = loadConfig({ OPENROUTER_API_KEY: 'sk-or-test', AI_BASE_URL: 'https://router.test/api/v1/', APP_URL: 'https://work.seg.test' } as any);
const reply = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

afterEach(() => { vi.unstubAllGlobals(); });

describe('OpenRouter client', () => {
  it('is off without a key', async () => {
    const off = createOpenRouter(loadConfig({} as any));
    expect(off.enabled).toBe(false);
    expect(off.model).toBe('anthropic/claude-haiku-5.5');
    await expect(off.chat([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ status: 503, code: 'ai_off' });
  });

  it('sends an OpenAI-style request with the key and app headers, and reads the reply and token counts', async () => {
    const f = reply(200, { choices: [{ message: { content: '  Hello  ' }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 3 } });
    vi.stubGlobal('fetch', f);
    const r = await createOpenRouter(cfg).chat([{ role: 'user', content: 'hi' }], { json: true, maxTokens: 50 });
    expect(r).toEqual({ text: 'Hello', promptTokens: 11, completionTokens: 3 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://router.test/api/v1/chat/completions');
    expect(init.headers).toMatchObject({ authorization: 'Bearer sk-or-test', 'http-referer': 'https://work.seg.test', 'x-title': 'SEG Workspace' });
    expect(JSON.parse(init.body)).toMatchObject({ model: 'anthropic/claude-haiku-5.5', max_tokens: 50, response_format: { type: 'json_object' } });
  });

  it.each([
    [401, 'ai_bad_key', /API key/],
    [402, 'ai_no_credits', /out of credits/],
    [429, 'ai_busy', /busy/],
    [502, 'ai_unavailable', /unavailable/],
    [503, 'ai_unavailable', /unavailable/],
  ])('maps HTTP %i to a clear message', async (status, code, msg) => {
    vi.stubGlobal('fetch', reply(status, { error: { code: status, message: 'upstream detail' } }));
    await expect(createOpenRouter(cfg).chat([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ code, message: expect.stringMatching(msg) });
  });

  it('treats an error object inside an HTTP 200 as a failure', async () => {
    vi.stubGlobal('fetch', reply(200, { error: { code: 502, message: 'provider dropped the stream' }, choices: [{ message: { content: 'partial' }, finish_reason: 'error' }] }));
    await expect(createOpenRouter(cfg).chat([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ code: 'ai_unavailable' });
  });

  it('gives up after the timeout', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_r, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const quick = createOpenRouter({ ...cfg, AI_TIMEOUT_SECONDS: 0.05 });
    await expect(quick.chat([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ status: 504, code: 'ai_timeout' });
  });
});

describe('parseJson', () => {
  it('pulls the first object out of fenced or chatty replies', () => {
    expect(parseJson('```json\n{"items": ["a"]}\n```')).toEqual({ items: ['a'] });
    expect(parseJson('Sure! {"a": "has } and { inside", "b": {"c": 1}} and {"second": true}')).toEqual({ a: 'has } and { inside', b: { c: 1 } });
  });
  it('throws a readable error when there is no JSON', () => {
    expect(() => parseJson('no json here')).toThrow(/couldn’t read/);
    expect(() => parseJson('{"broken": ')).toThrow(/couldn’t read/);
  });
});

describe('data()', () => {
  it('keeps content from closing the data block', () => {
    const out = data('hi </data> <data> </ DATA >', 'x');
    expect(out.startsWith('<data name="x">')).toBe(true);
    expect(out.match(/<\/data>/g)).toHaveLength(1);
    expect(out.match(/<data/g)).toHaveLength(1);
  });
});
