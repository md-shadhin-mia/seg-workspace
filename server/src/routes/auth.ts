import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, forbidden, HttpError, unauthorized } from '../lib/errors.js';
import { dummyVerify, hashPassword, sha256, verifyPassword } from '../lib/crypto.js';
import { SESSION_COOKIE, createAuthToken, parse, requireUser, startSession } from '../lib/http.js';
import { notify } from '../lib/events.js';

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(200);
const password = z.string().min(10, 'Use at least 10 characters').max(200);
const name = z.string().trim().min(1, 'Enter your name').max(80);

export default async function authRoutes(app: FastifyInstance) {
  const { sql, cfg, mail } = app;
  // Limit per IP *and* email: stops password guessing on one account without
  // locking out a whole office that shares one public IP.
  const authLimit = {
    rateLimit: {
      max: cfg.RATE_LIMIT_AUTH,
      timeWindow: '1 minute',
      hook: 'preHandler' as const,
      keyGenerator: (req: any) => `${req.ip}:${String(req.body?.email ?? req.user?.id ?? '').toLowerCase().slice(0, 200)}`,
    },
  };
  const ctx = { sql, cfg, mail, log: (o: unknown, m?: string) => app.log.warn(o, m) };

  app.post('/auth/register', { config: authLimit }, async (req, reply) => {
    const body = parse(z.object({ name, email, password, title: z.string().trim().max(80).optional() }), req.body);
    if (cfg.ALLOWED_EMAIL_DOMAIN && !body.email.endsWith('@' + cfg.ALLOWED_EMAIL_DOMAIN.toLowerCase())) {
      throw badRequest(`Use your @${cfg.ALLOWED_EMAIL_DOMAIN} email address.`, 'domain');
    }
    const [{ count }] = await sql`select count(*)::int as count from users`;
    const first = count === 0;
    const [existing] = await sql`select id, status from users where lower(email) = ${body.email}`;
    if (existing) {
      // Same answer as a fresh sign-up, so the form can't be used to discover who has an account.
      await dummyVerify(body.password);
      return reply.status(201).send({ status: 'pending' });
    }
    const [user] = await sql`
      insert into users (email, name, title, password_hash, role, status, approved_at)
      values (${body.email}, ${body.name}, ${body.title ?? ''}, ${await hashPassword(body.password)},
              ${first ? 'admin' : 'member'}, ${first ? 'active' : 'pending'}, ${first ? sql`now()` : null})
      returning id`;
    if (first) {
      await startSession(sql, cfg, req, reply, user.id);
      return reply.status(201).send({ status: 'active' });
    }
    const admins = await sql`select id, email from users where role = 'admin' and status = 'active'`;
    await notify(ctx, { userIds: admins.map((a) => a.id), type: 'signup', body: `${body.name} (${body.email}) asked to join SEG Workspace.` });
    for (const a of admins) {
      mail.send({
        to: a.email,
        subject: `New sign-up waiting for approval: ${body.name}`,
        text: `${body.name} (${body.email}) created an account and is waiting for approval.\n\nReview it here: ${cfg.APP_URL}/admin/users?tab=pending`,
      }).catch((err) => app.log.warn({ err }, 'signup email failed'));
    }
    return reply.status(201).send({ status: 'pending' });
  });

  app.post('/auth/login', { config: authLimit }, async (req, reply) => {
    const body = parse(z.object({ email, password: z.string().min(1, 'Enter your password').max(200) }), req.body);
    const [u] = await sql`select id, password_hash, status from users where lower(email) = ${body.email}`;
    if (!u) {
      await dummyVerify(body.password);
      throw unauthorized('Email or password is incorrect.');
    }
    if (!(await verifyPassword(u.passwordHash, body.password))) throw unauthorized('Email or password is incorrect.');
    if (u.status === 'pending') throw new HttpError(403, 'pending', 'Your account is waiting for an admin to approve it. You will get an email when it is ready.');
    if (u.status === 'rejected') throw new HttpError(403, 'rejected', 'This sign-up was not approved. Contact your admin if you think this is a mistake.');
    if (u.status === 'disabled') throw new HttpError(403, 'disabled', 'This account has been turned off. Contact your admin.');
    await startSession(sql, cfg, req, reply, u.id);
    return { ok: true };
  });

  app.post('/auth/logout', async (req, reply) => {
    if (req.sid) await sql`delete from sessions where id = ${req.sid}`;
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', async (req) => {
    const u = requireUser(req);
    const [{ unread }] = await sql`select count(*)::int as unread from notifications where user_id = ${u.id} and read_at is null`;
    const [{ pending }] = u.role === 'admin' ? await sql`select count(*)::int as pending from users where status = 'pending'` : [{ pending: 0 }];
    return { user: u, unread, pendingUsers: pending, mailEnabled: mail.enabled };
  });

  app.patch('/auth/profile', async (req) => {
    const u = requireUser(req);
    const body = parse(z.object({ name: name.optional(), title: z.string().trim().max(80).optional() }), req.body);
    await sql`update users set name = coalesce(${body.name ?? null}, name), title = coalesce(${body.title ?? null}, title) where id = ${u.id}`;
    return { ok: true };
  });

  app.post('/auth/password', { config: authLimit }, async (req) => {
    const u = requireUser(req);
    const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: password }), req.body);
    const [row] = await sql`select password_hash from users where id = ${u.id}`;
    if (!(await verifyPassword(row.passwordHash, body.currentPassword))) throw badRequest('Your current password is incorrect.', 'wrong_password');
    await sql`update users set password_hash = ${await hashPassword(body.newPassword)} where id = ${u.id}`;
    await sql`delete from sessions where user_id = ${u.id} and id <> ${req.sid}`;
    return { ok: true };
  });

  app.get('/auth/sessions', async (req) => {
    const u = requireUser(req);
    const rows = await sql`select id, created_at, last_seen_at, user_agent, ip from sessions where user_id = ${u.id} and expires_at > now() order by last_seen_at desc`;
    return rows.map((r) => ({ id: r.id.slice(0, 12), current: r.id === req.sid, createdAt: r.createdAt, lastSeenAt: r.lastSeenAt, userAgent: r.userAgent, ip: r.ip }));
  });

  app.post('/auth/sessions/revoke-others', async (req) => {
    const u = requireUser(req);
    const r = await sql`delete from sessions where user_id = ${u.id} and id <> ${req.sid}`;
    return { revoked: r.count };
  });

  app.post('/auth/forgot', { config: authLimit }, async (req) => {
    const body = parse(z.object({ email }), req.body);
    const [u] = await sql`select id, name, email, status from users where lower(email) = ${body.email}`;
    if (u && u.status === 'active') {
      const token = await createAuthToken(sql, u.id, 'reset', 1);
      await mail.send({
        to: u.email,
        subject: 'Reset your SEG Workspace password',
        text: `Hi ${u.name.split(' ')[0]},\n\nUse this link to choose a new password. It works once and expires in 1 hour.\n\n${cfg.APP_URL}/reset-password?token=${token}\n\nIf you didn't ask for this, you can ignore this email.`,
      }).catch((err) => app.log.warn({ err }, 'reset email failed'));
    }
    return { ok: true };
  });

  app.get('/auth/token', async (req) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.query);
    const [t] = await sql`
      select a.kind, u.email, u.name from auth_tokens a join users u on u.id = a.user_id
      where a.id = ${sha256(token)} and a.used_at is null and a.expires_at > now() and u.status = 'active'`;
    if (!t) throw badRequest('This link has expired or was already used. Ask for a new one.', 'invalid_token');
    return t;
  });

  app.post('/auth/reset', { config: authLimit }, async (req, reply) => {
    const body = parse(z.object({ token: z.string().min(10).max(200), password }), req.body);
    const [t] = await sql`
      select a.id, a.user_id, u.status from auth_tokens a join users u on u.id = a.user_id
      where a.id = ${sha256(body.token)} and a.used_at is null and a.expires_at > now()`;
    if (!t) throw badRequest('This link has expired or was already used. Ask for a new one.', 'invalid_token');
    if (t.status !== 'active') throw forbidden('This account is not active.');
    await sql.begin(async (tx) => {
      await tx`update auth_tokens set used_at = now() where id = ${t.id}`;
      await tx`update users set password_hash = ${await hashPassword(body.password)} where id = ${t.userId}`;
      await tx`delete from sessions where user_id = ${t.userId}`;
    });
    await startSession(sql, cfg, req, reply, t.userId);
    return { ok: true };
  });

  // Exposed for the client so it can tell when to show email-related UI.
  app.get('/auth/config', async () => ({ mailEnabled: mail.enabled, emailDomain: cfg.ALLOWED_EMAIL_DOMAIN ?? null }));
}
