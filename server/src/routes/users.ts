import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { createAuthToken, idParam, parse, requireAdmin, requireUser, uuid } from '../lib/http.js';

const teamsInput = z.array(z.object({ teamId: uuid, role: z.enum(['lead', 'member']) })).max(50);

export default async function userRoutes(app: FastifyInstance) {
  const { sql, cfg, mail } = app;

  const userSelect = sql`
    u.id, u.email, u.name, u.title, u.role, u.status, u.created_at, u.last_login_at, u.approved_at,
    coalesce((select json_agg(json_build_object('teamId', tm.team_id, 'name', t.name, 'role', tm.role) order by t.name)
      from team_members tm join teams t on t.id = tm.team_id where tm.user_id = u.id), '[]') as teams`;

  /** Active people, for assignee pickers and @mentions. */
  app.get('/people', async (req) => {
    requireUser(req);
    return sql`select ${userSelect} from users u where u.status = 'active' order by u.name`;
  });

  app.get('/users', async (req) => {
    requireAdmin(req);
    const { status } = parse(z.object({ status: z.enum(['pending', 'active', 'rejected', 'disabled']).optional() }), req.query);
    return sql`select ${userSelect} from users u ${status ? sql`where u.status = ${status}` : sql``}
      order by (u.status = 'pending') desc, u.created_at desc`;
  });

  app.post('/users', async (req, reply) => {
    const admin = requireAdmin(req);
    const body = parse(z.object({
      name: z.string().trim().min(1).max(80),
      email: z.string().trim().toLowerCase().email().max(200),
      title: z.string().trim().max(80).default(''),
      role: z.enum(['admin', 'member']).default('member'),
      teams: teamsInput.default([]),
    }), req.body);
    const [exists] = await sql`select 1 from users where lower(email) = ${body.email}`;
    if (exists) throw conflict('Someone already uses that email.', 'email_taken');
    const user = await sql.begin(async (tx) => {
      const [u] = await tx`
        insert into users (email, name, title, role, status, approved_at, approved_by)
        values (${body.email}, ${body.name}, ${body.title}, ${body.role}, 'active', now(), ${admin.id}) returning id`;
      for (const t of body.teams) await tx`insert into team_members (team_id, user_id, role) values (${t.teamId}, ${u.id}, ${t.role})`;
      return u;
    });
    const token = await createAuthToken(sql, user.id, 'invite', 24 * 7);
    const url = `${cfg.APP_URL}/accept-invite?token=${token}`;
    await sendQuiet(body.email, `${admin.name} invited you to SEG Workspace`,
      `Hi ${body.name.split(' ')[0]},\n\n${admin.name} created an account for you on SEG Workspace. Choose a password to get started. The link expires in 7 days.\n\n${url}`);
    return reply.status(201).send({ id: user.id, inviteUrl: url, emailed: mail.enabled });
  });

  app.patch('/users/:id', async (req) => {
    const admin = requireAdmin(req);
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({
      name: z.string().trim().min(1).max(80).optional(),
      title: z.string().trim().max(80).optional(),
      role: z.enum(['admin', 'member']).optional(),
      status: z.enum(['active', 'rejected', 'disabled']).optional(),
    }), req.body);
    const [u] = await sql`select id, name, email, status, role from users where id = ${id}`;
    if (!u) throw notFound('User not found.');
    if (id === admin.id && ((body.role && body.role !== 'admin') || (body.status && body.status !== 'active'))) {
      throw badRequest('You cannot remove your own admin access or turn off your own account.');
    }
    if (u.role === 'admin' && (body.role === 'member' || (body.status && body.status !== 'active'))) {
      const [{ n }] = await sql`select count(*)::int as n from users where role = 'admin' and status = 'active' and id <> ${id}`;
      if (n === 0) throw badRequest('Keep at least one active admin.');
    }
    await sql`
      update users set
        name = coalesce(${body.name ?? null}, name),
        title = coalesce(${body.title ?? null}, title),
        role = coalesce(${body.role ?? null}, role),
        status = coalesce(${body.status ?? null}, status),
        approved_at = case when ${body.status ?? null}::text = 'active' and approved_at is null then now() else approved_at end,
        approved_by = case when ${body.status ?? null}::text = 'active' and approved_by is null then ${admin.id}::uuid else approved_by end
      where id = ${id}`;
    if (body.status && body.status !== 'active') await sql`delete from sessions where user_id = ${id}`;
    if (body.status === 'active' && u.status === 'pending') {
      await sendQuiet(u.email, 'Your SEG Workspace account is approved',
        `Hi ${u.name.split(' ')[0]},\n\n${admin.name} approved your account. You can sign in now.\n\n${cfg.APP_URL}/login`);
    }
    return { ok: true };
  });

  app.put('/users/:id/teams', async (req) => {
    requireAdmin(req);
    const { id } = parse(idParam, req.params);
    const { teams } = parse(z.object({ teams: teamsInput }), req.body);
    const [u] = await sql`select id from users where id = ${id}`;
    if (!u) throw notFound('User not found.');
    await sql.begin(async (tx) => {
      await tx`delete from team_members where user_id = ${id}`;
      for (const t of teams) await tx`insert into team_members (team_id, user_id, role) values (${t.teamId}, ${id}, ${t.role})`;
    });
    return { ok: true };
  });

  /** Fresh password link (reset for users with a password, invite for users who never set one). */
  app.post('/users/:id/reset-link', async (req) => {
    requireAdmin(req);
    const { id } = parse(idParam, req.params);
    const [u] = await sql`select id, name, email, status, password_hash from users where id = ${id}`;
    if (!u) throw notFound('User not found.');
    if (u.status !== 'active') throw badRequest('Approve or turn on this account first.');
    const invite = !u.passwordHash;
    const token = await createAuthToken(sql, u.id, invite ? 'invite' : 'reset', invite ? 24 * 7 : 24);
    const url = `${cfg.APP_URL}/${invite ? 'accept-invite' : 'reset-password'}?token=${token}`;
    await sendQuiet(u.email, invite ? 'Your SEG Workspace invite' : 'Reset your SEG Workspace password',
      `Hi ${u.name.split(' ')[0]},\n\nUse this link to ${invite ? 'set your password' : 'choose a new password'}. It works once.\n\n${url}`);
    return { url, emailed: mail.enabled };
  });

  async function sendQuiet(to: string, subject: string, text: string) {
    await mail.send({ to, subject, text }).catch((err) => app.log.warn({ err }, 'email failed'));
  }
}
