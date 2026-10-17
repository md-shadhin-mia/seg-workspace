import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, PW, setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
let admin: Client;
beforeAll(async () => { ctx = await setup(); admin = new Client(ctx.app); });
afterAll(async () => { await ctx.app.close(); });

describe('sign-up, approval and sign-in', () => {
  it('makes the very first account an active admin and signs it in', async () => {
    const r = await admin.post('/api/auth/register', { name: 'Farhana Chowdhury', email: 'Farhana@SEG.test', password: PW });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('active');
    const me = await admin.get('/api/auth/me');
    expect(me.body.user).toMatchObject({ email: 'farhana@seg.test', role: 'admin', status: 'active' });
  });

  it('keeps later sign-ups pending and blocks their sign-in until approved', async () => {
    const c = new Client(ctx.app);
    const r = await c.post('/api/auth/register', { name: 'Walid Hasan', email: 'walid@seg.test', password: PW });
    expect(r.body.status).toBe('pending');
    const login = await c.post('/api/auth/login', { email: 'walid@seg.test', password: PW });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('pending');
    expect(ctx.mailer.outbox.some((m) => m.to === 'farhana@seg.test' && m.subject.includes('Walid'))).toBe(true);
    const notes = await admin.get('/api/notifications');
    expect(notes.body[0].type).toBe('signup');
  });

  it('lets an admin approve, after which the user can sign in and gets an email', async () => {
    const list = await admin.get('/api/users?status=pending');
    const w = list.body.find((u: any) => u.email === 'walid@seg.test');
    expect((await admin.patch(`/api/users/${w.id}`, { status: 'active' })).status).toBe(200);
    expect(ctx.mailer.outbox.some((m) => m.to === 'walid@seg.test' && /approved/i.test(m.subject))).toBe(true);
    const c = new Client(ctx.app);
    const login = await c.post('/api/auth/login', { email: 'WALID@seg.test', password: PW });
    expect(login.status).toBe(200);
    expect(login.raw.headers['set-cookie']).toMatch(/HttpOnly/i);
    expect(login.raw.headers['set-cookie']).toMatch(/SameSite=Lax/i);
  });

  it('gives the same answer for a duplicate sign-up and does not create a second account', async () => {
    const c = new Client(ctx.app);
    const r = await c.post('/api/auth/register', { name: 'Imposter', email: 'walid@seg.test', password: 'another-password-1' });
    expect(r.status).toBe(201);
    const all = await admin.get('/api/users');
    expect(all.body.filter((u: any) => u.email === 'walid@seg.test')).toHaveLength(1);
  });

  it('rejects wrong passwords and unknown emails with one message', async () => {
    const c = new Client(ctx.app);
    const a = await c.post('/api/auth/login', { email: 'walid@seg.test', password: 'wrong-password!' });
    const b = await c.post('/api/auth/login', { email: 'nobody@seg.test', password: 'wrong-password!' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('validates sign-up input', async () => {
    const c = new Client(ctx.app);
    const r = await c.post('/api/auth/register', { name: 'X', email: 'not-an-email', password: 'short' });
    expect(r.status).toBe(400);
  });

  it('blocks state-changing requests that lack the CSRF header', async () => {
    const r = await admin.req('POST', '/api/auth/logout', {}, { 'x-requested-with': '' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('csrf');
  });

  it('protects API routes from anonymous access', async () => {
    const c = new Client(ctx.app);
    expect((await c.get('/api/tasks')).status).toBe(401);
    expect((await c.get('/api/users')).status).toBe(401);
  });

  it('keeps admin routes away from members', async () => {
    const c = new Client(ctx.app);
    await c.post('/api/auth/login', { email: 'walid@seg.test', password: PW });
    expect((await c.get('/api/users')).status).toBe(403);
    expect((await c.post('/api/teams', { name: 'Hackers' })).status).toBe(403);
  });
});

describe('password reset, invites and sessions', () => {
  it('resets a password through the emailed link, once', async () => {
    const c = new Client(ctx.app);
    expect((await c.post('/api/auth/forgot', { email: 'walid@seg.test' })).status).toBe(200);
    expect((await c.post('/api/auth/forgot', { email: 'ghost@seg.test' })).status).toBe(200);
    const mail = ctx.mailer.outbox.filter((m) => m.to === 'walid@seg.test' && /reset/i.test(m.subject)).pop()!;
    const token = mail.text.match(/token=([\w-]+)/)![1];
    expect((await c.get(`/api/auth/token?token=${token}`)).body.email).toBe('walid@seg.test');
    expect((await c.post('/api/auth/reset', { token, password: 'brand-new-password' })).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(200);
    expect((await c.post('/api/auth/reset', { token, password: 'again-new-password' })).status).toBe(400);
    const fresh = new Client(ctx.app);
    expect((await fresh.post('/api/auth/login', { email: 'walid@seg.test', password: 'brand-new-password' })).status).toBe(200);
  });

  it('lets an admin create a user who sets a password from the invite', async () => {
    const teams = (await admin.get('/api/teams')).body;
    const r = await admin.post('/api/users', { name: 'Tanvir Ahmed', email: 'tanvir@seg.test', title: 'Developer', teams: [{ teamId: teams[0].id, role: 'member' }] });
    expect(r.status).toBe(201);
    const token = new URL(r.body.inviteUrl).searchParams.get('token')!;
    const c = new Client(ctx.app);
    expect((await c.get(`/api/auth/token?token=${token}`)).body.kind).toBe('invite');
    expect((await c.post('/api/auth/reset', { token, password: 'tanvir-password-1' })).status).toBe(200);
    const me = await c.get('/api/auth/me');
    expect(me.body.user.teams[0].teamId).toBe(teams[0].id);
  });

  it('signs out other devices after a password change', async () => {
    const a = new Client(ctx.app);
    const b = new Client(ctx.app);
    await a.post('/api/auth/login', { email: 'tanvir@seg.test', password: 'tanvir-password-1' });
    await b.post('/api/auth/login', { email: 'tanvir@seg.test', password: 'tanvir-password-1' });
    expect((await a.post('/api/auth/password', { currentPassword: 'nope-nope-nope', newPassword: 'tanvir-password-2' })).status).toBe(400);
    expect((await a.post('/api/auth/password', { currentPassword: 'tanvir-password-1', newPassword: 'tanvir-password-2' })).status).toBe(200);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    expect((await b.get('/api/auth/me')).status).toBe(401);
  });

  it('ends all sessions when an account is turned off', async () => {
    const c = new Client(ctx.app);
    await c.post('/api/auth/login', { email: 'tanvir@seg.test', password: 'tanvir-password-2' });
    const t = (await admin.get('/api/users')).body.find((u: any) => u.email === 'tanvir@seg.test');
    await admin.patch(`/api/users/${t.id}`, { status: 'disabled' });
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await c.post('/api/auth/login', { email: 'tanvir@seg.test', password: 'tanvir-password-2' })).body.error.code).toBe('disabled');
  });

  it('refuses to let the last admin demote themselves', async () => {
    const me = (await admin.get('/api/auth/me')).body.user;
    expect((await admin.patch(`/api/users/${me.id}`, { role: 'member' })).status).toBe(400);
  });

  it('logs out', async () => {
    const c = new Client(ctx.app);
    await c.post('/api/auth/login', { email: 'walid@seg.test', password: 'brand-new-password' });
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });
});

describe('rate limiting', () => {
  it('limits repeated attempts per account without blocking other accounts on the same IP', async () => {
    const { setup: mk } = await import('./helpers.js');
    const local = await mk();
    (local.cfg as any).RATE_LIMIT_AUTH = 3;
    await local.app.close();
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp({ ...local.cfg, RATE_LIMIT_AUTH: 3 }, { mailer: local.mailer });
    const c = new Client(app);
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await c.post('/api/auth/login', { email: 'a@seg.test', password: 'x' })).status);
    expect(codes).toEqual([401, 401, 401, 429]);
    expect((await c.post('/api/auth/login', { email: 'b@seg.test', password: 'x' })).status).toBe(401);
    await app.close();
  });
});
