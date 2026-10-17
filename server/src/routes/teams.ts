import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { canManageTeam, canSeeTeam, isAdmin, teamIds } from '../lib/access.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { parse, requireAdmin, requireUser, uuid } from '../lib/http.js';

const teamBody = z.object({ name: z.string().trim().min(1).max(60), description: z.string().trim().max(300).default('') });

export default async function teamRoutes(app: FastifyInstance) {
  const { sql } = app;

  app.get('/teams', async (req) => {
    const u = requireUser(req);
    const ids = teamIds(u);
    return sql`
      select t.id, t.name, t.description,
        (select count(*)::int from team_members m where m.team_id = t.id) as member_count,
        (select count(*)::int from projects p where p.team_id = t.id and p.archived_at is null) as project_count,
        (select role from team_members m where m.team_id = t.id and m.user_id = ${u.id}) as my_role,
        coalesce((select json_agg(json_build_object('id', p.id, 'name', p.name, 'status', p.status) order by p.name)
          from projects p where p.team_id = t.id and p.archived_at is null), '[]') as projects
      from teams t
      ${isAdmin(u) ? sql`` : sql`where t.id = any(${sql.array(ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])}::uuid[])`}
      order by t.name`;
  });

  app.get('/teams/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    if (!canSeeTeam(u, id)) throw notFound('Team not found.');
    const [team] = await sql`select id, name, description from teams where id = ${id}`;
    if (!team) throw notFound('Team not found.');
    const members = await sql`
      select u.id, u.name, u.title, u.email, m.role,
        (select count(*)::int from task_assignees a join tasks t on t.id = a.task_id join projects p on p.id = t.project_id
          where a.user_id = u.id and a.status <> 'done' and p.team_id = ${id}) as open_tasks,
        (select count(*)::int from task_assignees a join tasks t on t.id = a.task_id join projects p on p.id = t.project_id
          where a.user_id = u.id and a.status <> 'done' and p.team_id = ${id} and t.due_date < current_date) as overdue_tasks
      from team_members m join users u on u.id = m.user_id
      where m.team_id = ${id} and u.status = 'active'
      order by (m.role = 'lead') desc, u.name`;
    return { ...team, members, canManage: canManageTeam(u, id) };
  });

  app.post('/teams', async (req, reply) => {
    requireAdmin(req);
    const body = parse(teamBody, req.body);
    const [dup] = await sql`select 1 from teams where lower(name) = lower(${body.name})`;
    if (dup) throw conflict('A team with that name already exists.');
    const [t] = await sql`insert into teams (name, description) values (${body.name}, ${body.description}) returning id`;
    return reply.status(201).send(t);
  });

  app.patch('/teams/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    if (!canManageTeam(u, id)) throw forbidden();
    const body = parse(teamBody.partial(), req.body);
    await sql`update teams set name = coalesce(${body.name ?? null}, name), description = coalesce(${body.description ?? null}, description) where id = ${id}`;
    return { ok: true };
  });

  app.delete('/teams/:id', async (req) => {
    requireAdmin(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const [{ n }] = await sql`select count(*)::int as n from projects where team_id = ${id}`;
    if (n > 0) throw badRequest('Move or delete this team’s projects first.');
    await sql`delete from teams where id = ${id}`;
    return { ok: true };
  });

  /** Leads can add members; only admins can make someone a lead. */
  app.put('/teams/:id/members/:userId', async (req) => {
    const u = requireUser(req);
    const { id, userId } = parse(z.object({ id: uuid, userId: uuid }), req.params);
    const { role } = parse(z.object({ role: z.enum(['lead', 'member']).default('member') }), req.body);
    if (!canManageTeam(u, id)) throw forbidden();
    if (role === 'lead' && !isAdmin(u)) throw forbidden('Only admins can make someone a team lead.');
    const [target] = await sql`select status from users where id = ${userId}`;
    if (!target || target.status !== 'active') throw badRequest('That person is not an active user.');
    await sql`insert into team_members (team_id, user_id, role) values (${id}, ${userId}, ${role})
      on conflict (team_id, user_id) do update set role = excluded.role`;
    return { ok: true };
  });

  app.delete('/teams/:id/members/:userId', async (req) => {
    const u = requireUser(req);
    const { id, userId } = parse(z.object({ id: uuid, userId: uuid }), req.params);
    if (!canManageTeam(u, id)) throw forbidden();
    const [m] = await sql`select role from team_members where team_id = ${id} and user_id = ${userId}`;
    if (m?.role === 'lead' && !isAdmin(u)) throw forbidden('Only admins can remove a team lead.');
    await sql`delete from team_members where team_id = ${id} and user_id = ${userId}`;
    return { ok: true };
  });
}
