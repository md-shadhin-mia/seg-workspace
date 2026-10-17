import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isAdmin, visibleProjectCond, visibleTaskCond } from '../lib/access.js';
import { parse, requireUser } from '../lib/http.js';

export default async function miscRoutes(app: FastifyInstance) {
  const { sql } = app;

  app.get('/health', { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await sql`select 1`;
      return { ok: true };
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });

  app.get('/dashboard', async (req) => {
    const u = requireUser(req);
    const [counts] = await sql`
      select
        count(*) filter (where a.status <> 'done' and t.due_date = current_date)::int as due_today,
        count(*) filter (where a.status <> 'done' and t.due_date < current_date)::int as overdue,
        count(*) filter (where a.status = 'changes')::int as changes,
        count(*) filter (where a.status = 'review')::int as in_review,
        count(*) filter (where a.status not in ('done'))::int as open
      from task_assignees a join tasks t on t.id = a.task_id join projects p on p.id = t.project_id
      where a.user_id = ${u.id} and p.archived_at is null`;
    const focus = await sql`
      select t.id, t.seq, t.title, t.priority, t.due_date, t.status, a.status as my_status, p.name as project_name,
        coalesce((select json_agg(json_build_object('userId', x.user_id, 'name', xu.name, 'status', x.status) order by x.assigned_at)
          from task_assignees x join users xu on xu.id = x.user_id where x.task_id = t.id), '[]') as assignees
      from task_assignees a join tasks t on t.id = a.task_id join projects p on p.id = t.project_id
      where a.user_id = ${u.id} and a.status not in ('done', 'review') and p.archived_at is null
      order by (a.status = 'changes') desc, t.due_date asc nulls last,
        array_position(array['urgent','high','medium','low'], t.priority) limit 8`;
    const leadTeams = u.teams.filter((t) => t.role === 'lead').map((t) => t.teamId);
    const reviewQueue = await sql`
      select s.id as submission_id, s.version, s.created_at, s.user_id, su.name as user_name, t.id as task_id, t.title, p.name as project_name
      from submissions s join tasks t on t.id = s.task_id join projects p on p.id = t.project_id join users su on su.id = s.user_id
      where s.state = 'pending' and s.user_id <> ${u.id} and p.archived_at is null and (
        ${isAdmin(u)} or t.reviewer_id = ${u.id}
        or (t.reviewer_id is null and p.team_id = any(${sql.array(leadTeams.length ? leadTeams : ['00000000-0000-0000-0000-000000000000'])}::uuid[])))
      order by s.created_at limit 20`;
    const teams = (isAdmin(u) || leadTeams.length) ? await sql`
      select tm.id, tm.name,
        count(t.id) filter (where t.status <> 'done')::int as open,
        count(t.id) filter (where t.status <> 'done' and t.due_date < current_date)::int as overdue,
        count(t.id) filter (where t.status = 'review' or exists (select 1 from submissions s where s.task_id = t.id and s.state = 'pending'))::int as review,
        count(t.id) filter (where t.status = 'done')::int as done,
        count(t.id)::int as total
      from teams tm left join projects p on p.team_id = tm.id and p.archived_at is null left join tasks t on t.project_id = p.id
      where ${isAdmin(u)} or tm.id = any(${sql.array(leadTeams.length ? leadTeams : ['00000000-0000-0000-0000-000000000000'])}::uuid[])
      group by tm.id, tm.name order by tm.name` : [];
    return { counts, focus, reviewQueue, teams, isLead: leadTeams.length > 0 || isAdmin(u) };
  });

  app.get('/search', async (req) => {
    const u = requireUser(req);
    const { q } = parse(z.object({ q: z.string().trim().min(1).max(100) }), req.query);
    const like = '%' + q.replace(/[%_\\]/g, '\\$&') + '%';
    const [tasks, projects, people] = await Promise.all([
      sql`select t.id, t.seq, t.title, t.status, p.name as project_name from tasks t join projects p on p.id = t.project_id
          where p.archived_at is null and ${visibleTaskCond(sql, u)} and (t.title ilike ${like} or t.seq::text = ${q.replace(/^#/, '')})
          order by (t.status = 'done'), t.updated_at desc limit 8`,
      sql`select p.id, p.name, tm.name as team_name from projects p join teams tm on tm.id = p.team_id
          where p.archived_at is null and ${visibleProjectCond(sql, u)} and p.name ilike ${like} order by p.name limit 5`,
      sql`select id, name, title from users where status = 'active' and (name ilike ${like} or email ilike ${like}) order by name limit 5`,
    ]);
    return { tasks, projects, people };
  });
}
