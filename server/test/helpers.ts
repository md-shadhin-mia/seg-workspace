import type { FastifyInstance } from 'fastify';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { memoryMailer } from '../src/lib/mailer.js';
import type { AiClient, ChatMessage, ChatOptions } from '../src/lib/ai.js';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://seg:seg@localhost:5432/seg_test';

/** Fake AI client: records every prompt and answers with `reply`. Flip `enabled` or set `fail` to test errors. */
export function fakeAi(reply: (messages: ChatMessage[], opts: ChatOptions) => string = () => 'ok') {
  const f = {
    enabled: true,
    model: 'test/fake-model',
    calls: [] as { messages: ChatMessage[]; opts: ChatOptions }[],
    reply,
    fail: null as Error | null,
    async chat(messages: ChatMessage[], opts: ChatOptions = {}) {
      f.calls.push({ messages, opts });
      if (f.fail) throw f.fail;
      return { text: f.reply(messages, opts), promptTokens: 120, completionTokens: 30 };
    },
    /** Everything sent to the model in the last call, as one string. */
    lastPrompt: () => f.calls.at(-1)!.messages.map((m) => m.content).join('\n'),
  };
  return f satisfies AiClient;
}

export async function setup(opts: { ai?: AiClient; env?: Record<string, string> } = {}) {
  const admin = createDb(TEST_DB, 1);
  await admin.unsafe('drop schema public cascade; create schema public;');
  await admin.end();
  const mailer = memoryMailer();
  const cfg = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB,
    APP_URL: 'http://localhost:3000',
    UPLOAD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'seg-up-')),
    WEB_DIST: '/nonexistent',
    RATE_LIMIT_AUTH: '1000',
    MAX_UPLOAD_MB: '1',
    ...opts.env,
  } as any);
  const app = await buildApp(cfg, { mailer, ai: opts.ai });
  return { app, mailer, cfg };
}

/** Minimal browser-like client: keeps the session cookie and sends the CSRF header. */
export class Client {
  cookie = '';
  constructor(private app: FastifyInstance) {}
  async req(method: string, url: string, body?: unknown, extra: Record<string, string> = {}) {
    const res = await this.app.inject({
      method: method as any,
      url,
      payload: body as any,
      headers: { 'x-requested-with': 'seg-web', ...(this.cookie ? { cookie: this.cookie } : {}), ...extra },
    });
    const set = res.headers['set-cookie'];
    if (set) {
      const c = (Array.isArray(set) ? set : [set]).find((x) => x.startsWith('seg_session='));
      if (c) this.cookie = c.split(';')[0].endsWith('=') ? '' : c.split(';')[0];
    }
    let json: any = null;
    try { json = res.json(); } catch {}
    return { status: res.statusCode, body: json, raw: res };
  }
  get = (u: string) => this.req('GET', u);
  post = (u: string, b?: unknown) => this.req('POST', u, b ?? {});
  patch = (u: string, b?: unknown) => this.req('PATCH', u, b ?? {});
  put = (u: string, b?: unknown) => this.req('PUT', u, b ?? {});
  del = (u: string) => this.req('DELETE', u);
}

export const PW = 'correct-horse-battery';

/** Registers + approves a user and returns a logged-in client. */
export async function makeUser(app: FastifyInstance, admin: Client, name: string, teams: { teamId: string; role: 'lead' | 'member' }[]) {
  const c = new Client(app);
  const email = `${name.toLowerCase().replace(/\s+/g, '.')}@seg.test`;
  await c.post('/api/auth/register', { name, email, password: PW });
  const users = await admin.get('/api/users?status=pending');
  const u = users.body.find((x: any) => x.email === email);
  await admin.patch(`/api/users/${u.id}`, { status: 'active' });
  await admin.put(`/api/users/${u.id}/teams`, { teams });
  const r = await c.post('/api/auth/login', { email, password: PW });
  if (r.status !== 200) throw new Error('login failed ' + JSON.stringify(r.body));
  return { client: c, id: u.id as string, email };
}
