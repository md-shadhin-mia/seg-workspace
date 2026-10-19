import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { canSeeTeam, canManageTeam, isAdmin } from '../lib/access.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse, requireAdmin, requireUser, uuid } from '../lib/http.js';
import {
  addDays, bucketSize, computeMetrics, daysBetween, normalizeSettings, previousPeriod, trend,
  type AssignmentRow, type KpiSettings, type ReviewRow,
} from '../lib/kpi.js';
import { STATUSES, type SessionUser, type Status } from '../lib/types.js';

/**
 * Performance analytics, always scoped on the server:
 * - personal: the caller's own assignments (everyone)
 * - team:     work in projects of teams the caller leads (team leads)
 * - org:      every team (admins)
 */
type View = 'personal' | 'team' | 'org';
const NONE = '00000000-0000-0000-0000-000000000000';
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');
const rangeQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });

interface Scope { teamIds: string[] | null; userId: string | null; projectId: string | null; status: Status | null }

export const leadTeamIds = (u: SessionUser) => u.teams.filter((t) => t.role === 'lead').map((t) => t.teamId);
export function viewsFor(u: SessionUser): View[] {
  if (isAdmin(u)) return ['org', 'personal'];
  return leadTeamIds(u).length ? ['team', 'personal'] : ['personal'];
}

export default async function analyticsRoutes(app: FastifyInstance) {
  const { sql } = app;

  async function settings(): Promise<KpiSettings> {
    const [row] = await sql`select settings from kpi_settings where id = 1`;
    return normalizeSettings(row?.settings);
  }

  /** Resolves the period; `to` never goes past today and the span is capped at two years. */
  async function period(q: { from?: string; to?: string }) {
    const [{ today }] = await sql`select current_date as today`;
    const to = q.to && q.to < today ? q.to : today as string;
    const from = q.from ?? addDays(to, -29);
    if (from > to) throw badRequest('The start date must be before the end date.');
    if (daysBetween(from, to) > 731) throw badRequest('Pick a range of two years or less.');
    const prev = previousPeriod(from, to);
    return { today: today as string, from, to, prevFrom: prev.from, prevTo: prev.to, bucket: bucketSize(from, to) };
  }

  const teamCond = (s: Scope) => (s.teamIds ? sql`and p.team_id = any(${sql.array(s.teamIds.length ? s.teamIds : [NONE])}::uuid[])` : sql``);

  async function assignmentRows(s: Scope, since: string, to: string): Promise<AssignmentRow[]> {
    return (await sql`
      select a.task_id, a.user_id, p.team_id, t.project_id, a.status, a.assigned_at::date as assigned_on,
        case when a.status = 'done' then a.updated_at::date end as done_on, t.due_date
      from task_assignees a join tasks t on t.id = a.task_id join projects p on p.id = t.project_id
      where p.archived_at is null and a.assigned_at::date <= ${to}
        and (a.status <> 'done' or a.updated_at::date >= ${since})
        ${teamCond(s)}
        ${s.userId ? sql`and a.user_id = ${s.userId}` : sql``}
        ${s.projectId ? sql`and t.project_id = ${s.projectId}` : sql``}
        ${s.status ? sql`and a.status = ${s.status}` : sql``}`) as unknown as AssignmentRow[];
  }

  async function reviewRows(s: Scope, since: string, to: string): Promise<ReviewRow[]> {
    return (await sql`
      select s.user_id, p.team_id, t.project_id, s.state = 'approved' as approved, s.reviewed_at::date as reviewed_on
      from submissions s join tasks t on t.id = s.task_id join projects p on p.id = t.project_id
      where p.archived_at is null and s.reviewed_at is not null and s.state in ('approved', 'changes')
        and s.reviewed_at::date between ${since} and ${to}
        ${teamCond(s)}
        ${s.userId ? sql`and s.user_id = ${s.userId}` : sql``}
        ${s.projectId ? sql`and t.project_id = ${s.projectId}` : sql``}`) as unknown as ReviewRow[];
  }

  /** Open deadlines (overdue or due within two weeks): the caller's own, or every task in scope. */
  async function deadlines(s: Scope, personal: boolean, today: string) {
    return sql`
      select t.id, t.seq, t.title, t.priority, t.due_date, t.status, p.id as project_id, p.name as project_name,
        ${personal ? sql`a.status` : sql`t.status`} as my_status,
        coalesce((select json_agg(json_build_object('userId', x.user_id, 'name', xu.name, 'status', x.status) order by x.assigned_at)
          from task_assignees x join users xu on xu.id = x.user_id where x.task_id = t.id), '[]') as assignees
      from tasks t join projects p on p.id = t.project_id
        ${personal ? sql`join task_assignees a on a.task_id = t.id and a.user_id = ${s.userId}` : sql``}
      where p.archived_at is null and t.due_date is not null and t.due_date <= ${addDays(today, 14)}
        and ${personal ? sql`a.status <> 'done'` : sql`t.status <> 'done'`}
        ${teamCond(s)}
        ${!personal && s.userId ? sql`and exists (select 1 from task_assignees y where y.task_id = t.id and y.user_id = ${s.userId})` : sql``}
        ${s.projectId ? sql`and t.project_id = ${s.projectId}` : sql``}
      order by t.due_date, array_position(array['urgent','high','medium','low'], t.priority)
      limit 12`;
  }

  /** Open work per due date around today, for the calendar. */
  async function dueCalendar(s: Scope, personal: boolean, today: string) {
    return sql`
      select t.due_date as date, count(*)::int as count
      from tasks t join projects p on p.id = t.project_id
        ${personal ? sql`join task_assignees a on a.task_id = t.id and a.user_id = ${s.userId}` : sql``}
      where p.archived_at is null and t.due_date between ${addDays(today, -45)} and ${addDays(today, 75)}
        and ${personal ? sql`a.status <> 'done'` : sql`t.status <> 'done'`}
        ${teamCond(s)}
        ${!personal && s.userId ? sql`and exists (select 1 from task_assignees y where y.task_id = t.id and y.user_id = ${s.userId})` : sql``}
        ${s.projectId ? sql`and t.project_id = ${s.projectId}` : sql``}
      group by t.due_date order by t.due_date`;
  }

  async function recentActivity(s: Scope) {
    const items = await sql`
      select a.id, a.action, a.meta, a.created_at, a.actor_id, u.name as actor_name, t.id as task_id, t.title as task_title
      from activity a join tasks t on t.id = a.task_id join projects p on p.id = t.project_id left join users u on u.id = a.actor_id
      where p.archived_at is null and a.action in ('created', 'assigned', 'status', 'submitted', 'approved', 'changes_requested')
        and a.created_at > now() - interval '30 days'
        ${teamCond(s)}
        ${s.userId ? sql`and exists (select 1 from task_assignees y where y.task_id = t.id and y.user_id = ${s.userId})` : sql``}
        ${s.projectId ? sql`and t.project_id = ${s.projectId}` : sql``}
      order by a.created_at desc limit 12`;
    const ids = [...new Set(items.flatMap((i) => [i.meta?.userId, ...(i.meta?.userIds ?? [])]).filter(Boolean))] as string[];
    const names = ids.length ? await sql`select id, name from users where id = any(${sql.array(ids)}::uuid[])` : [];
    return { items, names: Object.fromEntries(names.map((n) => [n.id, n.name])) };
  }

  /** Assignments grouped by project, with project names. */
  async function contributions(rows: AssignmentRow[], from: string, to: string, cfg: KpiSettings) {
    const byProject = new Map<string, AssignmentRow[]>();
    for (const r of rows) byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r]);
    if (!byProject.size) return [];
    const projects = await sql`select p.id, p.name, tm.name as team_name from projects p join teams tm on tm.id = p.team_id
      where p.id = any(${sql.array([...byProject.keys()])}::uuid[])`;
    return projects
      .map((p) => {
        const m = computeMetrics(byProject.get(p.id)!, [], from, to, cfg);
        return { id: p.id, name: p.name, teamName: p.teamName, active: m.active, completed: m.completed, open: m.open, overdue: m.overdue, onTimeRate: m.onTimeRate };
      })
      .filter((p) => p.active > 0 || p.open > 0)
      .sort((a, b) => b.completed - a.completed || b.open - a.open);
  }

  // ---------- overview: dashboard and analytics page ----------
  app.get('/analytics/overview', async (req) => {
    const u = requireUser(req);
    const q = parse(rangeQuery.extend({
      view: z.enum(['personal', 'team', 'org']).optional(),
      teamId: uuid.optional(),
      department: z.string().trim().max(60).optional(),
      projectId: uuid.optional(),
      userId: uuid.optional(),
      status: z.enum(STATUSES as [Status, ...Status[]]).optional(),
    }), req.query);
    const views = viewsFor(u);
    const view = q.view ?? views[0];
    if (!views.includes(view)) throw forbidden('You can only see analytics for teams you lead.');
    const personal = view === 'personal';
    const [cfg, range] = await Promise.all([settings(), period(q)]);

    // Teams this view may cover, then narrowed by the filters.
    const allTeams = await sql`select id, name, department from teams order by name`;
    const allowed = personal ? null : view === 'org' ? allTeams.map((t) => t.id as string) : leadTeamIds(u);
    let teamIds = allowed;
    if (q.teamId) {
      if (allowed && !allowed.includes(q.teamId)) throw notFound('Team not found.');
      teamIds = [q.teamId];
    }
    if (q.department !== undefined && q.department !== '') {
      const inDept = allTeams.filter((t) => t.department === q.department).map((t) => t.id as string);
      teamIds = (teamIds ?? inDept).filter((id) => inDept.includes(id));
    }
    if (q.projectId) {
      const [p] = await sql`select team_id from projects where id = ${q.projectId} and archived_at is null`;
      if (!p || (allowed && !allowed.includes(p.teamId))) throw notFound('Project not found.');
    }
    const scope: Scope = { teamIds, userId: personal ? u.id : q.userId ?? null, projectId: q.projectId ?? null, status: q.status ?? null };

    const [rows, reviews, due, calendar, activity] = await Promise.all([
      assignmentRows(scope, range.prevFrom, range.to),
      reviewRows(scope, range.prevFrom, range.to),
      deadlines(scope, personal, range.today),
      dueCalendar(scope, personal, range.today),
      recentActivity(scope),
    ]);
    const summary = computeMetrics(rows, reviews, range.from, range.to, cfg);
    const previous = computeMetrics(rows, reviews, range.prevFrom, range.prevTo, cfg);
    const series = trend(rows, range.from, range.to);

    // Filter options, limited to what this view may see.
    const scopedTeams = allowed ? allTeams.filter((t) => allowed.includes(t.id)) : [];
    const projectOptions = personal
      ? await sql`select distinct p.id, p.name, p.team_id from projects p join tasks t on t.project_id = p.id join task_assignees a on a.task_id = t.id
          where a.user_id = ${u.id} and p.archived_at is null order by p.name`
      : await sql`select p.id, p.name, p.team_id from projects p where p.archived_at is null
          and p.team_id = any(${sql.array(allowed!.length ? allowed! : [NONE])}::uuid[]) order by p.name`;

    const base = {
      view, views, range, settings: cfg, summary, previous, trend: series, deadlines: due, calendar, activity,
      filters: {
        teams: scopedTeams.map((t) => ({ id: t.id, name: t.name, department: t.department })),
        departments: [...new Set(scopedTeams.map((t) => t.department as string).filter(Boolean))].sort(),
        projects: projectOptions,
        people: [] as { id: string; name: string; title: string }[],
      },
    };
    if (personal) return { ...base, contributions: await contributions(rows, range.from, range.to, cfg), people: [], teams: [], projects: [] };

    // People: active members of the teams in scope, plus anyone assigned work there.
    const members = await sql`
      select u.id, u.name, u.title,
        coalesce(array_agg(distinct t.name) filter (where t.id is not null), '{}') as team_names
      from users u
        left join team_members m on m.user_id = u.id and m.team_id = any(${sql.array(teamIds!.length ? teamIds! : [NONE])}::uuid[])
        left join teams t on t.id = m.team_id
      where u.status = 'active' and (m.user_id is not null or u.id = any(${sql.array([...new Set(rows.map((r) => r.userId))].concat(NONE))}::uuid[]))
      group by u.id order by u.name`;
    base.filters.people = members.map((m) => ({ id: m.id, name: m.name, title: m.title }));
    const rowsBy = <K extends 'userId' | 'teamId'>(k: K) => {
      const map = new Map<string, AssignmentRow[]>();
      for (const r of rows) map.set(r[k], [...(map.get(r[k]) ?? []), r]);
      return map;
    };
    const reviewsBy = <K extends 'userId' | 'teamId'>(k: K) => {
      const map = new Map<string, ReviewRow[]>();
      for (const r of reviews) map.set(r[k], [...(map.get(r[k]) ?? []), r]);
      return map;
    };
    const byUser = rowsBy('userId'), revByUser = reviewsBy('userId');
    const people = members
      .filter((m) => !q.userId || m.id === q.userId)
      .map((m) => {
        const r = byUser.get(m.id) ?? [], v = revByUser.get(m.id) ?? [];
        return {
          id: m.id, name: m.name, title: m.title, teamNames: m.teamNames,
          metrics: computeMetrics(r, v, range.from, range.to, cfg),
          previousScore: computeMetrics(r, v, range.prevFrom, range.prevTo, cfg).score,
          spark: trend(r, range.from, range.to).map((b) => b.completed),
        };
      });
    const byTeam = rowsBy('teamId'), revByTeam = reviewsBy('teamId');
    const memberCounts = await sql`select team_id, count(*)::int as n from team_members m join users u on u.id = m.user_id
      where u.status = 'active' group by team_id`;
    const teams = (teamIds ?? []).map((id) => {
      const t = allTeams.find((x) => x.id === id)!;
      const r = byTeam.get(id) ?? [], v = revByTeam.get(id) ?? [];
      return {
        id, name: t.name, department: t.department, members: memberCounts.find((c) => c.teamId === id)?.n ?? 0,
        metrics: computeMetrics(r, v, range.from, range.to, cfg),
        previousScore: computeMetrics(r, v, range.prevFrom, range.prevTo, cfg).score,
        trend: trend(r, range.from, range.to).map((b) => b.completed),
      };
    });
    const projects = await sql`
      select p.id, p.name, p.status, p.due_date, p.team_id, tm.name as team_name,
        count(t.id)::int as total,
        count(t.id) filter (where t.status = 'done')::int as done,
        count(t.id) filter (where t.status = 'in_progress')::int as in_progress,
        count(t.id) filter (where t.status = 'review')::int as review,
        count(t.id) filter (where t.status = 'changes')::int as changes,
        count(t.id) filter (where t.status = 'todo')::int as todo,
        count(t.id) filter (where t.status <> 'done' and t.due_date < ${range.today})::int as overdue,
        count(t.id) filter (where t.status = 'done' and t.completed_at::date between ${range.from} and ${range.to})::int as done_in_period
      from projects p join teams tm on tm.id = p.team_id left join tasks t on t.project_id = p.id
        ${q.status ? sql`and t.status = ${q.status}` : sql``}
        ${q.userId ? sql`and exists (select 1 from task_assignees y where y.task_id = t.id and y.user_id = ${q.userId})` : sql``}
      where p.archived_at is null ${teamCond(scope)} ${q.projectId ? sql`and p.id = ${q.projectId}` : sql``}
      group by p.id, tm.name order by (count(t.id) filter (where t.status <> 'done' and t.due_date < ${range.today})) desc, p.name`;
    return { ...base, people, teams, projects, contributions: [] };
  });

  // ---------- one person ----------
  app.get('/analytics/people/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const q = parse(rangeQuery, req.query);
    const [person] = await sql`select id, name, title, email, status from users where id = ${id}`;
    if (!person) throw notFound('Person not found.');
    const theirTeams = await sql`select tm.team_id, t.name, tm.role from team_members tm join teams t on t.id = tm.team_id where tm.user_id = ${id} order by t.name`;
    // Self and admins see everything; a lead sees only work in the teams they lead.
    let teamIds: string[] | null = null;
    if (id !== u.id && !isAdmin(u)) {
      const lead = leadTeamIds(u);
      if (!lead.length) throw notFound('Person not found.');
      const [{ n }] = await sql`select count(*)::int as n from task_assignees a join tasks t on t.id = a.task_id join projects p on p.id = t.project_id
        where a.user_id = ${id} and p.team_id = any(${sql.array(lead)}::uuid[])`;
      if (!theirTeams.some((t) => lead.includes(t.teamId)) && n === 0) throw notFound('Person not found.');
      teamIds = lead;
    }
    const [cfg, range] = await Promise.all([settings(), period(q)]);
    const scope: Scope = { teamIds, userId: id, projectId: null, status: null };
    const [rows, reviews, due, recent] = await Promise.all([
      assignmentRows(scope, range.prevFrom, range.to),
      reviewRows(scope, range.prevFrom, range.to),
      deadlines(scope, true, range.today),
      sql`select t.id, t.seq, t.title, t.due_date, a.updated_at as done_at, a.updated_at::date as done_on, p.name as project_name
        from task_assignees a join tasks t on t.id = a.task_id join projects p on p.id = t.project_id
        where a.user_id = ${id} and a.status = 'done' and p.archived_at is null
          and a.updated_at::date between ${range.from} and ${range.to} ${teamCond(scope)}
        order by a.updated_at desc limit 10`,
    ]);
    return {
      person: { id: person.id, name: person.name, title: person.title, active: person.status === 'active', teams: theirTeams },
      scopeTeams: teamIds ? theirTeams.filter((t) => teamIds!.includes(t.teamId)).map((t) => t.name) : null,
      range, settings: cfg,
      summary: computeMetrics(rows, reviews, range.from, range.to, cfg),
      previous: computeMetrics(rows, reviews, range.prevFrom, range.prevTo, cfg),
      trend: trend(rows, range.from, range.to),
      contributions: await contributions(rows, range.from, range.to, cfg),
      deadlines: due,
      recent,
    };
  });

  // ---------- one project ----------
  app.get('/analytics/projects/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const q = parse(rangeQuery, req.query);
    const [p] = await sql`select id, name, team_id, due_date, status, created_at::date as created_on from projects where id = ${id}`;
    if (!p || !canSeeTeam(u, p.teamId)) throw notFound('Project not found.');
    const range = await period(q);
    const [tasks, people] = await Promise.all([
      sql`select t.id, t.seq, t.title, t.status, t.priority, t.due_date, t.created_at::date as created_on, t.completed_at::date as completed_on,
          coalesce((select json_agg(json_build_object('userId', x.user_id, 'name', xu.name, 'status', x.status) order by x.assigned_at)
            from task_assignees x join users xu on xu.id = x.user_id where x.task_id = t.id), '[]') as assignees
        from tasks t where t.project_id = ${id} order by t.due_date nulls last, t.seq`,
      sql`select a.user_id, u.name, u.title, a.status, t.due_date, case when a.status = 'done' then a.updated_at::date end as done_on
        from task_assignees a join tasks t on t.id = a.task_id join users u on u.id = a.user_id where t.project_id = ${id}`,
    ]);
    const today = range.today;
    const count = (s: Status) => tasks.filter((t) => t.status === s).length;
    const overdue = tasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < today);
    const late = tasks.filter((t) => t.status === 'done' && t.dueDate && t.completedOn && t.completedOn > t.dueDate);
    // Burn-up: tasks that existed and tasks done at the end of each bucket.
    const progress = trend([], range.from, range.to).map((b) => ({
      start: b.start, end: b.end,
      total: tasks.filter((t) => t.createdOn <= b.end).length,
      done: tasks.filter((t) => t.completedOn && t.completedOn <= b.end).length,
    }));
    const byPerson = new Map<string, { id: string; name: string; title: string; assigned: number; done: number; open: number; overdue: number; onTime: number; withDue: number }>();
    for (const r of people) {
      const x = byPerson.get(r.userId) ?? { id: r.userId, name: r.name, title: r.title, assigned: 0, done: 0, open: 0, overdue: 0, onTime: 0, withDue: 0 };
      x.assigned++;
      if (r.status === 'done') {
        x.done++;
        if (r.dueDate) { x.withDue++; if (r.doneOn <= r.dueDate) x.onTime++; }
      } else {
        x.open++;
        if (r.dueDate && r.dueDate < today) x.overdue++;
      }
      byPerson.set(r.userId, x);
    }
    const doneTotal = count('done');
    return {
      project: { id: p.id, name: p.name, dueDate: p.dueDate, status: p.status, createdOn: p.createdOn },
      canManage: canManageTeam(u, p.teamId),
      range,
      totals: {
        total: tasks.length, done: doneTotal, inProgress: count('in_progress'), review: count('review'), changes: count('changes'), todo: count('todo'),
        overdue: overdue.length, late: late.length, noDueDate: tasks.filter((t) => !t.dueDate && t.status !== 'done').length,
        pct: tasks.length ? Math.round((doneTotal / tasks.length) * 100) : 0,
      },
      progress,
      members: [...byPerson.values()].map((m) => ({ ...m, onTimeRate: m.withDue ? Math.round((m.onTime / m.withDue) * 100) : null }))
        .sort((a, b) => b.done - a.done || b.assigned - a.assigned),
      timeline: tasks.filter((t) => t.dueDate).map((t) => ({ id: t.id, seq: t.seq, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, completedOn: t.completedOn, assignees: t.assignees })),
      delayed: [...overdue, ...late].map((t) => ({ id: t.id, seq: t.seq, title: t.title, status: t.status, dueDate: t.dueDate, completedOn: t.completedOn, assignees: t.assignees })),
    };
  });

  // ---------- scoring rules ----------
  app.get('/analytics/settings', async (req) => {
    requireUser(req);
    return settings();
  });

  app.put('/analytics/settings', async (req) => {
    const u = requireAdmin(req);
    const body = parse(z.object({
      weights: z.object({ completion: z.number(), onTime: z.number(), approval: z.number(), backlog: z.number() }),
      targets: z.object({ completion: z.number(), onTime: z.number(), approval: z.number(), weeklyCompleted: z.number() }),
      minSample: z.number(),
    }), req.body);
    const next = normalizeSettings(body);
    if (Object.values(next.weights).every((w) => w === 0)) throw badRequest('Give at least one part of the score a weight.');
    await sql`insert into kpi_settings (id, settings, updated_by) values (1, ${sql.json(next as any)}, ${u.id})
      on conflict (id) do update set settings = excluded.settings, updated_by = excluded.updated_by, updated_at = now()`;
    return next;
  });
}
