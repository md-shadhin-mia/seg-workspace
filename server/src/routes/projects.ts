import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { canManageTeam, canSeeTeam, visibleProjectCond } from '../lib/access.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/events.js';
import { parse, requireUser, uuid } from '../lib/http.js';
import { PRIORITIES } from '../lib/types.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date').nullable();
const status = z.enum(['on_track', 'at_risk', 'off_track', 'completed']);
const newTask = z.object({
  title: z.string().trim().min(1, 'Give the task a title').max(200),
  description: z.string().max(20000).default(''),
  priority: z.enum(PRIORITIES).default('medium'),
  dueDate: date.optional(),
  assigneeIds: z.array(uuid).max(20).default([]),
});

export default async function projectRoutes(app: FastifyInstance) {
  const { sql, cfg, mail } = app;
  const ctx = { sql, cfg, mail, log: (o: unknown, m?: string) => app.log.warn(o, m) };

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
      description: z.string().trim().max(6000).default(''),
      dueDate: date.optional(),
      leadId: uuid.optional(),
      tasks: z.array(newTask).max(30).default([]),
    }), req.body);
    if (!canManageTeam(u, body.teamId)) throw forbidden('Only team leads and admins can create projects.');
    const assigneeIds = [...new Set(body.tasks.flatMap((t) => t.assigneeIds))];
    if (assigneeIds.length) {
      const [{ n }] = await sql`select count(*)::int as n from users where id = any(${sql.array(assigneeIds)}::uuid[]) and status = 'active'`;
      if (n !== assigneeIds.length) throw badRequest('One of the people you picked is not an active user.');
    }
    // The project and all of its tasks are created together, or not at all.
    const { project, tasks } = await sql.begin(async (tx) => {
      const [project] = await tx`
        insert into projects (team_id, name, description, due_date, lead_id, created_by)
        values (${body.teamId}, ${body.name}, ${body.description}, ${body.dueDate ?? null}, ${body.leadId ?? u.id}, ${u.id})
        returning id`;
      const tasks: { id: string; title: string; assigneeIds: string[] }[] = [];
      for (const t of body.tasks) {
        const ids = [...new Set(t.assigneeIds)];
        const [row] = await tx`
          insert into tasks (project_id, title, description, priority, due_date, created_by)
          values (${project.id}, ${t.title}, ${t.description}, ${t.priority}, ${t.dueDate ?? null}, ${u.id})
          returning id`;
        for (const a of ids) await tx`insert into task_assignees (task_id, user_id, assigned_by) values (${row.id}, ${a}, ${u.id})`;
        await tx`insert into activity (task_id, actor_id, action, meta) values (${row.id}, ${u.id}, 'created', '{}')`;
        if (ids.length) await tx`insert into activity (task_id, actor_id, action, meta) values (${row.id}, ${u.id}, 'assigned', ${tx.json({ userIds: ids })})`;
        tasks.push({ id: row.id, title: t.title, assigneeIds: ids });
      }
      return { project, tasks };
    });
    for (const t of tasks) {
      await notify(ctx, { userIds: t.assigneeIds, type: 'assigned', taskId: t.id, actorId: u.id,
        body: `${u.name} assigned you "${t.title}" in ${body.name}.`, subject: `New task: ${t.title}` });
    }
    return reply.status(201).send({ id: project.id, taskIds: tasks.map((t) => t.id) });
  });

  app.patch('/projects/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const [p] = await sql`select team_id from projects where id = ${id}`;
    if (!p || !canSeeTeam(u, p.teamId)) throw notFound('Project not found.');
    if (!canManageTeam(u, p.teamId)) throw forbidden();
    const body = parse(z.object({
      name: z.string().trim().min(1).max(100).optional(),
      description: z.string().trim().max(6000).optional(),
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
