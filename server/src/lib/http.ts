import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Sql } from '../db.js';
import type { Config } from '../config.js';
import { badRequest, forbidden, unauthorized } from './errors.js';
import { randomToken, sha256 } from './crypto.js';
import type { SessionUser } from './types.js';

export const SESSION_COOKIE = 'seg_session';

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const i = r.error.issues[0];
    const field = i.path.join('.');
    throw badRequest(field ? `${field}: ${i.message}` : i.message, 'validation');
  }
  return r.data;
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
export function requireAdmin(req: FastifyRequest): SessionUser {
  const u = requireUser(req);
  if (u.role !== 'admin') throw forbidden('Only admins can do that.');
  return u;
}

export const uuid = z.string().uuid();
export const idParam = z.object({ id: uuid });

export async function loadSessionUser(sql: Sql, cfg: Config, token: string): Promise<{ user: SessionUser; sid: string } | null> {
  const sid = sha256(token);
  const [row] = await sql`
    select s.id as sid, s.last_seen_at, u.id, u.email, u.name, u.title, u.role, u.status
    from sessions s join users u on u.id = s.user_id
    where s.id = ${sid} and s.expires_at > now()`;
  if (!row || row.status !== 'active') return null;
  const teams = await sql`
    select tm.team_id, t.name, tm.role from team_members tm join teams t on t.id = tm.team_id
    where tm.user_id = ${row.id} order by t.name`;
  // Sliding expiry, written at most once an hour.
  if (Date.now() - new Date(row.lastSeenAt).getTime() > 3600_000) {
    await sql`update sessions set last_seen_at = now(), expires_at = now() + ${cfg.SESSION_DAYS + ' days'}::interval where id = ${sid}`;
  }
  const { sid: _s, lastSeenAt: _l, ...u } = row;
  return { sid, user: { ...(u as any), teams: teams as any } };
}

export async function startSession(sql: Sql, cfg: Config, req: FastifyRequest, reply: FastifyReply, userId: string) {
  const token = randomToken();
  await sql`
    insert into sessions (id, user_id, expires_at, user_agent, ip)
    values (${sha256(token)}, ${userId}, now() + ${cfg.SESSION_DAYS + ' days'}::interval, ${(req.headers['user-agent'] ?? '').slice(0, 300)}, ${req.ip})`;
  await sql`update users set last_login_at = now() where id = ${userId}`;
  reply.setCookie(SESSION_COOKIE, token, cookieOpts(cfg));
}

export function cookieOpts(cfg: Config) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: cfg.APP_URL.startsWith('https://'),
    path: '/',
    maxAge: cfg.SESSION_DAYS * 86400,
  };
}

export async function createAuthToken(sql: Sql, userId: string, kind: 'reset' | 'invite', hours: number) {
  const token = randomToken();
  await sql`update auth_tokens set used_at = now() where user_id = ${userId} and kind = ${kind} and used_at is null`;
  await sql`insert into auth_tokens (id, user_id, kind, expires_at) values (${sha256(token)}, ${userId}, ${kind}, now() + ${hours + ' hours'}::interval)`;
  return token;
}

/** Loads a fresh session user (used after membership changes within the same request). */
export async function reloadUser(sql: Sql, userId: string): Promise<SessionUser> {
  const [u] = await sql`select id, email, name, title, role, status from users where id = ${userId}`;
  const teams = await sql`select tm.team_id, t.name, tm.role from team_members tm join teams t on t.id = tm.team_id where tm.user_id = ${userId} order by t.name`;
  return { ...(u as any), teams: teams as any };
}
