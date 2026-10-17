import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { canManageTeam, canSeeTeam, visibleProjectCond } from '../lib/access.js';
import { forbidden, notFound } from '../lib/errors.js';
import { parse, requireUser, uuid } from '../lib/http.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date').nullable();
const status = z.enum(['on_track', 'at_risk', 'off_track', 'completed']);

export default async function projectRoutes(app: FastifyInstance) {
  const { sql } = app;

  const stats = sql`
    (select count(*)::int from tasks t where t.project_id = p.id) as task_count,
    (select count(*)::int from tasks t where t.project_id = p.id and t.status = 'done') as done_count,
    (select count(*)::int from tasks t where t.project_id = p.id and (t.status = 'review'
      or exists (select 1 from submissions s where s.task_id = t.id and s.state = 'pending'))) as review_count,
    (select count(*)::int from tasks t where t.project_id = p.id and t.status <> 'done' and t.due_date < current_date) as overdue_count`;

  app.get('/projects', async (req) => {
    const u = requireUser(req);
    return sql`
      select p.id, p.name, p.description, p.status, p.due_date, p.team_id, tm.name as team_name, p.lead_id, l.name as lead_name, ${stats}
      from projects p join teams tm on tm.id = p.team_id left join users l on l.id = p.lead_id
      where p.archived_at is null and ${visibleProjectCond(sql, u)}
      order by tm.name, p.name`;
  });

  app.get('/projects/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const [p] = await sql`
      select p.*, tm.name as team_name, l.name as lead_name, ${stats}
      from projects p join teams tm on tm.id = p.team_id left join users l on l.id = p.lead_id where p.id = ${id}`;
    if (!p || !canSeeTeam(u, p.teamId)) throw notFound('Project not found.');
    const members = await sql`
      select u.id, u.name, u.title, m.role from team_members m join users u on u.id = m.user_id
      where m.team_id = ${p.teamId} and u.status = 'active' order by (m.role = 'lead') desc, u.name`;
    return { ...p, members, canManage: canManageTeam(u, p.teamId) };
  });

  app.post('/projects', async (req, reply) => {
    const u = requireUser(req);
    const body = parse(z.object({
      teamId: uuid,
      name: z.string().trim().min(1, 'Name the project').max(100),
      description: z.string().trim().max(2000).default(''),
      dueDate: date.optional(),
      leadId: uuid.optional(),
    }), req.body);
    if (!canManageTeam(u, body.teamId)) throw forbidden('Only team leads and admins can create projects.');
    const [p] = await sql`
      insert into projects (team_id, name, description, due_date, lead_id, created_by)
      values (${body.teamId}, ${body.name}, ${body.description}, ${body.dueDate ?? null}, ${body.leadId ?? u.id}, ${u.id})
      returning id`;
    return reply.status(201).send(p);
  });

  app.patch('/projects/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const [p] = await sql`select team_id from projects where id = ${id}`;
    if (!p || !canSeeTeam(u, p.teamId)) throw notFound('Project not found.');
    if (!canManageTeam(u, p.teamId)) throw forbidden();
    const body = parse(z.object({
      name: z.string().trim().min(1).max(100).optional(),
      description: z.string().trim().max(2000).optional(),
      status: status.optional(),
      dueDate: date.optional(),
      leadId: uuid.nullable().optional(),
    }), req.body);
    await sql`
      update projects set
        name = coalesce(${body.name ?? null}, name),
        description = coalesce(${body.description ?? null}, description),
        status = coalesce(${body.status ?? null}, status),
        due_date = case when ${body.dueDate !== undefined} then ${body.dueDate ?? null}::date else due_date end,
        lead_id = case when ${body.leadId !== undefined} then ${body.leadId ?? null}::uuid else lead_id end
      where id = ${id}`;
    return { ok: true };
  });

  app.delete('/projects/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const [p] = await sql`select team_id from projects where id = ${id}`;
    if (!p || !canSeeTeam(u, p.teamId)) throw notFound('Project not found.');
    if (!canManageTeam(u, p.teamId)) throw forbidden();
    await sql`update projects set archived_at = now() where id = ${id}`;
    return { ok: true };
  });
}
