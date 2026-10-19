import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { canManageTeam, isAdmin, taskAccess, visibleProjectCond, visibleTaskCond } from '../lib/access.js';
import { DATA_RULE, aiOff, data, parseJson, type ChatMessage, type ChatOptions } from '../lib/ai.js';
import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse, requireAdmin, requireUser, uuid } from '../lib/http.js';
import { PRIORITIES, type SessionUser, type Status } from '../lib/types.js';

const STATUS_LABEL: Record<Status, string> = { todo: 'To Do', in_progress: 'In Progress', review: 'Ready for Review', changes: 'Changes Requested', done: 'Done' };
const BASE = `You are the assistant inside SEG Workspace, the task and review tool used by SEG Digital's staff. ${DATA_RULE}`;
const ASK_CONTEXT_CHARS = 24_000;
const NONE = '00000000-0000-0000-0000-000000000000';

const isoDate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

/** The model's plan, validated loosely: bad fields fall back to safe values instead of failing the whole plan. */
const PlanTask = z.object({
  title: z.string().trim().min(1).transform((s) => s.slice(0, 200)),
  description: z.string().trim().catch('').transform((s) => s.slice(0, 2000)),
  priority: z.enum(PRIORITIES).catch('medium'),
  assigneeId: z.string().nullable().catch(null),
  dueDate: z.string().nullable().catch(null),
});
const Plan = z.object({
  description: z.string().trim().catch('').transform((s) => s.slice(0, 2000)),
  objectives: z.array(z.string().trim().min(1).max(300)).catch([]),
  milestones: z.array(z.object({ title: z.string().trim().min(1).max(200), dueDate: z.string().nullable().catch(null) })).catch([]),
  tasks: z.array(z.unknown()).catch([]),
  risks: z.array(z.string().trim().min(1).max(300)).catch([]),
});

export default async function aiRoutes(app: FastifyInstance) {
  const { sql, cfg, ai } = app;
  const today = async () => (await sql`select current_date::text as d`)[0].d as string;
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: cfg.APP_TIMEZONE });
  /** Dates are YYYY-MM-DD strings already; timestamps are shown as the day they happened in APP_TIMEZONE. */
  const day = (d: string | Date | null | undefined) => (!d ? 'none' : typeof d === 'string' ? d.slice(0, 10) : ymd.format(d));

  /** Every AI call goes through here: checks it's on, enforces the hourly limit and logs usage (failures too). */
  async function run(u: SessionUser, feature: string, messages: ChatMessage[], opts?: ChatOptions) {
    if (!ai.enabled) throw aiOff();
    const [{ n }] = await sql`select count(*)::int as n from ai_usage where user_id = ${u.id} and created_at > now() - interval '1 hour'`;
    if (n >= cfg.AI_REQUESTS_PER_HOUR) {
      throw new HttpError(429, 'ai_limit', `You've used AI ${cfg.AI_REQUESTS_PER_HOUR} times in the last hour, which is the limit. Try again a bit later.`);
    }
    try {
      const r = await ai.chat(messages, opts);
      await sql`insert into ai_usage (user_id, feature, model, prompt_tokens, completion_tokens, ok)
        values (${u.id}, ${feature}, ${ai.model}, ${r.promptTokens}, ${r.completionTokens}, true)`;
      return r;
    } catch (err) {
      await sql`insert into ai_usage (user_id, feature, model, ok) values (${u.id}, ${feature}, ${ai.model}, false)`
        .catch((e) => app.log.warn({ err: e }, 'could not log AI usage'));
      if (err instanceof HttpError) throw err;
      app.log.error({ err }, 'AI request failed');
      throw new HttpError(502, 'ai_error', 'The AI service returned an error. Try again in a moment.');
    }
  }

  app.get('/ai/status', async (req) => {
    requireUser(req);
    return { enabled: ai.enabled, model: ai.model };
  });

  app.get('/ai/usage', async (req) => {
    requireAdmin(req);
    const month = sql`created_at >= date_trunc('month', now())`;
    const [[totals], top, byFeature] = await Promise.all([
      sql`select count(*)::int as requests, count(*) filter (where not ok)::int as failed,
            coalesce(sum(prompt_tokens), 0)::int as prompt_tokens, coalesce(sum(completion_tokens), 0)::int as completion_tokens
          from ai_usage where ${month}`,
      sql`select a.user_id, u.name, count(*)::int as requests, coalesce(sum(a.prompt_tokens + a.completion_tokens), 0)::int as tokens
          from ai_usage a left join users u on u.id = a.user_id where a.created_at >= date_trunc('month', now())
          group by a.user_id, u.name order by requests desc, tokens desc limit 5`,
      sql`select feature, count(*)::int as requests from ai_usage where ${month} group by feature order by requests desc`,
    ]);
    return { enabled: ai.enabled, model: ai.model, limitPerHour: cfg.AI_REQUESTS_PER_HOUR, ...totals, top, byFeature };
  });

  // ---------- task helpers ----------
  app.post('/tasks/:id/ai', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({
      action: z.enum(['improve', 'summarize', 'checklist', 'feedback']),
      draft: z.string().max(20000).optional(),
    }), req.body);
    const acc = await taskAccess(sql, u, id);
    if (!ai.enabled) throw aiOff();
    if ((body.action === 'improve' || body.action === 'checklist') && !acc.perms.edit) {
      throw forbidden('Only assignees, the creator and team leads can edit this task.');
    }
    const t = acc.task;

    if (body.action === 'improve') {
      const text = (body.draft ?? t.description).trim();
      if (!text) throw badRequest('Write a few notes in the description first, then AI can tidy them up.');
      const r = await run(u, 'task_improve', [
        { role: 'system', content: `${BASE}
Rewrite the task description so it is clear and easy to act on. Use exactly these three headings, each on its own line, in this order:
Goal
What's needed
Done when
Under "Goal" write one or two sentences. Under the other two headings use short bullet points starting with "- ".
Keep every fact, name, number, date and link from the original. Do not invent requirements, numbers, dates or details that are not in it. If a section has nothing to go on, write "- Not specified yet".
Plain text only: no Markdown symbols such as ** or #. Reply with the rewritten description and nothing else.` },
        { role: 'user', content: data(`Task title: ${t.title}\n\nDescription:\n${text}`, 'task') },
      ]);
      return { text: r.text };
    }

    if (body.action === 'checklist') {
      const existing = await sql`select text from checklist_items where task_id = ${id} order by position, created_at`;
      const r = await run(u, 'task_checklist', [
        { role: 'system', content: `${BASE}
Break the task into a checklist of concrete steps. Reply with JSON only, in the form {"items": ["...", "..."]}.
Give 3 to 7 items. Each starts with a verb, is under 100 characters, and is something one person can tick off.
Skip anything already on the existing checklist. Base the steps only on the task; don't add unrelated work.` },
        { role: 'user', content: data(`Task title: ${t.title}\n\nDescription:\n${(body.draft ?? t.description) || '(none)'}\n\nExisting checklist:\n${existing.map((c) => `- ${c.text}`).join('\n') || '(empty)'}`, 'task') },
      ], { json: true });
      const parsed = z.object({ items: z.array(z.unknown()).catch([]) }).catch({ items: [] }).parse(parseJson(r.text));
      const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const seen = new Set(existing.map((c) => norm(c.text)));
      const items: string[] = [];
      for (const raw of parsed.items) {
        if (typeof raw !== 'string') continue;
        const s = clean(raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ''), 300);
        if (!s || seen.has(norm(s))) continue;
        seen.add(norm(s));
        items.push(s);
      }
      return { items: items.slice(0, 7) };
    }

    if (body.action === 'feedback') {
      const subs = await sql`
        select s.version, s.state, s.feedback, s.created_at, s.reviewed_at, su.name as user_name, r.name as reviewer_name
        from submissions s join users su on su.id = s.user_id left join users r on r.id = s.reviewed_by
        where s.task_id = ${id} order by su.name, s.version`;
      if (!subs.some((s) => s.feedback?.trim())) throw badRequest('There’s no reviewer feedback on this task yet.', 'no_feedback');
      const lines = subs.map((s) => `${s.userName}, version ${s.version} (${day(s.createdAt)}): ${s.state === 'pending' ? 'waiting for review' : s.state === 'approved' ? 'approved' : 'changes requested'}`
        + (s.feedback?.trim() ? `\nFeedback from ${s.reviewerName ?? 'the reviewer'}: ${s.feedback.trim()}` : ''));
      const r = await run(u, 'task_feedback', [
        { role: 'system', content: `${BASE}
Summarise the reviewer feedback across all submitted versions of this task, so the person fixing it sees everything in one place.
Use short bullet points starting with "- ". Group by person if more than one person submitted. Point out feedback that came up more than once.
Finish with a line starting "Still open:" that lists what still needs fixing, or "Still open: nothing" if each person's latest version is approved.
Use only the data given. Plain text, no Markdown headings or bold.` },
        { role: 'user', content: data(`Task: ${t.title}\n\n${lines.join('\n\n')}`, 'submissions') },
      ]);
      return { text: r.text };
    }

    // summarize
    const [assignees, checklist, subs, comments, activity] = await Promise.all([
      sql`select u.name, a.status from task_assignees a join users u on u.id = a.user_id where a.task_id = ${id} order by a.assigned_at`,
      sql`select text, done from checklist_items where task_id = ${id} order by position, created_at`,
      sql`select su.name, s.version, s.state, s.feedback, s.created_at from submissions s join users su on su.id = s.user_id where s.task_id = ${id} order by s.created_at`,
      sql`select * from (select u.name, c.body, c.created_at from comments c left join users u on u.id = c.author_id
          where c.task_id = ${id} order by c.created_at desc limit 20) x order by created_at`,
      sql`select * from (select u.name, a.action, a.meta, a.created_at from activity a left join users u on u.id = a.actor_id
          where a.task_id = ${id} order by a.created_at desc, a.id desc limit 25) x order by created_at`,
    ]);
    const [reviewer] = t.reviewerId ? await sql`select name from users where id = ${t.reviewerId}` : [];
    const facts = [
      `Today: ${await today()}`,
      `Task #${t.seq}: ${t.title}`,
      `Project: ${t.projectName} (${t.teamName})`,
      `Overall status: ${STATUS_LABEL[t.status]} · Priority: ${t.priority} · Due: ${day(t.dueDate)}`,
      `Reviewer: ${reviewer?.name ?? `${t.teamName} team leads`}`,
      `Description:\n${t.description || '(none)'}`,
      `Assignees:\n${assignees.map((a) => `- ${a.name}: ${STATUS_LABEL[a.status as Status]}`).join('\n') || '(nobody assigned)'}`,
      `Checklist (${checklist.filter((c) => c.done).length}/${checklist.length} done):\n${checklist.map((c) => `- [${c.done ? 'x' : ' '}] ${c.text}`).join('\n') || '(empty)'}`,
      `Submissions:\n${subs.map((s) => `- ${s.name} v${s.version} on ${day(s.createdAt)}: ${s.state}${s.feedback ? ` (feedback: ${clean(s.feedback, 400)})` : ''}`).join('\n') || '(none)'}`,
      `Recent comments:\n${comments.map((c) => `- ${c.name ?? 'Former user'} on ${day(c.createdAt)}: ${clean(c.body, 500)}`).join('\n') || '(none)'}`,
      `Recent activity:\n${activity.map((a) => `- ${day(a.createdAt)} ${a.name ?? 'Someone'}: ${a.action}${a.meta?.to ? ` → ${a.meta.to}` : ''}${a.meta?.version ? ` v${a.meta.version}` : ''}${a.meta?.text ? ` "${clean(a.meta.text, 100)}"` : ''}`).join('\n') || '(none)'}`,
    ].join('\n\n');
    const r = await run(u, 'task_summarize', [
      { role: 'system', content: `${BASE}
Summarise where this task stands for a busy teammate. Reply with 3 to 5 short bullet points starting with "- ", covering: the overall status, who has done what, anything blocking or overdue, and the next step.
Use only the data given and mention people by name. Plain text, no Markdown headings or bold.` },
      { role: 'user', content: data(facts, 'task') },
    ]);
    return { text: r.text };
  });

  // ---------- project plan ----------
  app.post('/ai/plan', async (req) => {
    const u = requireUser(req);
    const body = parse(z.object({
      teamId: uuid,
      name: z.string().trim().min(1, 'Name the project').max(100),
      brief: z.string().trim().min(1, 'Describe the project first').max(4000),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date').nullable().optional(),
    }), req.body);
    if (!canManageTeam(u, body.teamId)) throw forbidden('Only team leads and admins can plan projects.');
    const [team] = await sql`select name from teams where id = ${body.teamId}`;
    if (!team) throw notFound('Team not found.');
    if (!ai.enabled) throw aiOff();
    const members = await sql`
      select u.id, u.name, u.title from team_members m join users u on u.id = m.user_id
      where m.team_id = ${body.teamId} and u.status = 'active' order by u.name`;
    const now = await today();

    const r = await run(u, 'project_plan', [
      { role: 'system', content: `${BASE}
Draft a project plan for a team lead to review before anything is created. Reply with JSON only, in this form:
{"description": "2-4 sentence summary of the project",
 "objectives": ["..."],
 "milestones": [{"title": "...", "dueDate": "YYYY-MM-DD or null"}],
 "tasks": [{"title": "...", "description": "...", "priority": "urgent|high|medium|low", "assigneeId": "a team member id, or null", "dueDate": "YYYY-MM-DD or null"}],
 "risks": ["..."]}
Rules:
- 5 to 12 tasks, never more than 15. Each is small enough for one person in one to five days and its title starts with a verb.
- Task descriptions are 1-3 sentences: what's needed and how we know it's done.
- assigneeId must be an id from the team member list. Match the work to each person's job title and spread it fairly; use null if nobody fits.
- Dates are YYYY-MM-DD, never before today, and not after the project due date if there is one.
- 3-5 objectives, 2-5 milestones, 2-4 risks.
- Base everything on the brief. Don't invent budgets, client names, numbers or facts that aren't in it.` },
      { role: 'user', content: [
        `Today: ${now}`,
        `Project due date: ${body.dueDate ?? 'not set'}`,
        `Team members of ${team.name}:\n${data(members.map((m) => `id: ${m.id} | ${m.name} | ${m.title || 'no title'}`).join('\n') || '(no members)', 'members')}`,
        `Project:\n${data(`Name: ${body.name}\n\nBrief:\n${body.brief}`, 'brief')}`,
      ].join('\n\n') },
    ], { json: true, maxTokens: Math.max(cfg.AI_MAX_TOKENS, 3000) });

    const plan = Plan.parse(parseJson(r.text));
    const memberIds = new Set(members.map((m) => m.id as string));
    const okDate = (d: string | null) => (isoDate(d) && d >= now ? d : null);
    const tasks = plan.tasks
      .map((x) => PlanTask.safeParse(x))
      .flatMap((x) => (x.success ? [x.data] : []))
      .slice(0, 15)
      .map((x) => ({ ...x, assigneeId: x.assigneeId && memberIds.has(x.assigneeId) ? x.assigneeId : null, dueDate: okDate(x.dueDate) }));
    return {
      description: plan.description,
      objectives: plan.objectives.slice(0, 8),
      milestones: plan.milestones.slice(0, 8).map((m) => ({ title: m.title, dueDate: okDate(m.dueDate) })),
      tasks,
      risks: plan.risks.slice(0, 8),
      members: members.map((m) => ({ id: m.id, name: m.name, title: m.title })),
    };
  });

  // ---------- ask about your work ----------
  app.post('/ai/ask', async (req) => {
    const u = requireUser(req);
    const { question } = parse(z.object({ question: z.string().trim().min(1, 'Type a question').max(500) }), req.body);
    if (!ai.enabled) throw aiOff();
    const now = await today();
    const leadTeams = u.teams.filter((t) => t.role === 'lead').map((t) => t.teamId);
    const showWorkload = isAdmin(u) || leadTeams.length > 0;

    // Only data this person can already see in the app: their tasks, their review queue,
    // their teams' projects and open tasks (visibleTaskCond), and workload for teams they lead.
    const [mine, reviews, projects, teamTasks, workload] = await Promise.all([
      sql`select t.id, t.seq, t.title, t.status, t.priority, t.due_date, a.status as my_status, p.name as project_name
          from task_assignees a join tasks t on t.id = a.task_id join projects p on p.id = t.project_id
          where a.user_id = ${u.id} and p.archived_at is null and (a.status <> 'done' or a.updated_at > now() - interval '14 days')
          order by (a.status = 'done'), t.due_date asc nulls last limit 60`,
      sql`select t.id, t.seq, t.title, s.version, s.created_at, su.name as user_name
          from submissions s join tasks t on t.id = s.task_id join projects p on p.id = t.project_id join users su on su.id = s.user_id
          where s.state = 'pending' and s.user_id <> ${u.id} and p.archived_at is null and (
            ${isAdmin(u)} or t.reviewer_id = ${u.id}
            or (t.reviewer_id is null and p.team_id = any(${sql.array(leadTeams.length ? leadTeams : [NONE])}::uuid[])))
          order by s.created_at limit 30`,
      sql`select p.name, p.status, p.due_date, tm.name as team_name,
            (select count(*)::int from tasks t where t.project_id = p.id) as total,
            (select count(*)::int from tasks t where t.project_id = p.id and t.status = 'done') as done,
            (select count(*)::int from tasks t where t.project_id = p.id and t.status <> 'done' and t.due_date < current_date) as overdue
          from projects p join teams tm on tm.id = p.team_id
          where p.archived_at is null and ${visibleProjectCond(sql, u)} order by tm.name, p.name limit 60`,
      sql`select t.id, t.seq, t.title, t.status, t.priority, t.due_date, p.name as project_name,
            coalesce((select string_agg(au.name || ' (' || a.status || ')', ', ' order by a.assigned_at)
              from task_assignees a join users au on au.id = a.user_id where a.task_id = t.id), '') as assignees
          from tasks t join projects p on p.id = t.project_id
          where p.archived_at is null and t.status <> 'done' and ${visibleTaskCond(sql, u)}
            and not exists (select 1 from task_assignees x where x.task_id = t.id and x.user_id = ${u.id})
          order by t.due_date asc nulls last, t.seq desc limit 150`,
      showWorkload ? sql`
          select tm.name as team_name, u.name,
            (select count(*)::int from task_assignees a join tasks t on t.id = a.task_id join projects p on p.id = t.project_id
              where a.user_id = u.id and a.status <> 'done' and p.team_id = m.team_id and p.archived_at is null) as open,
            (select count(*)::int from task_assignees a join tasks t on t.id = a.task_id join projects p on p.id = t.project_id
              where a.user_id = u.id and a.status <> 'done' and p.team_id = m.team_id and p.archived_at is null and t.due_date < current_date) as overdue
          from team_members m join teams tm on tm.id = m.team_id join users u on u.id = m.user_id
          where u.status = 'active' and (${isAdmin(u)} or m.team_id = any(${sql.array(leadTeams.length ? leadTeams : [NONE])}::uuid[]))
          order by tm.name, u.name` : Promise.resolve([]),
    ]);

    const overdue = (d: string | null, s: string) => (d && d < now && s !== 'done' ? ' (overdue)' : '');
    type Line = { text: string; ref?: [number, string] };
    const sections: [string, Line[]][] = [
      ['My tasks', mine.map((t) => ({ ref: [Number(t.seq), t.id], text:
        `#${t.seq} ${t.title} | project: ${t.projectName} | my status: ${STATUS_LABEL[t.myStatus as Status]} | overall: ${STATUS_LABEL[t.status as Status]} | ${t.priority} priority | due ${day(t.dueDate)}${overdue(t.dueDate, t.myStatus)}` }))],
      ['Submissions waiting for my review', reviews.map((s) => ({ ref: [Number(s.seq), s.id], text:
        `#${s.seq} ${s.title} | ${s.userName} submitted version ${s.version} on ${day(s.createdAt)}` }))],
      ['Projects in my teams', projects.map((p) => ({ text:
        `${p.name} (${p.teamName}) | ${p.status.replace(/_/g, ' ')} | due ${day(p.dueDate)} | ${p.done}/${p.total} tasks done, ${p.overdue} overdue` }))],
      ...(showWorkload ? [['Team workload (open tasks per person)', workload.map((w) => ({ text: `${w.teamName}: ${w.name} has ${w.open} open, ${w.overdue} overdue` }))] as [string, Line[]]] : []),
      ['Other open tasks in my teams', teamTasks.map((t) => ({ ref: [Number(t.seq), t.id], text:
        `#${t.seq} ${t.title} | project: ${t.projectName} | ${STATUS_LABEL[t.status as Status]} | ${t.priority} priority | due ${day(t.dueDate)}${overdue(t.dueDate, t.status)} | assignees: ${t.assignees || 'nobody'}` }))],
    ];

    // Highest-value sections first, cut off at ~24k characters.
    const refs = new Map<number, string>();
    let context = `Person asking: ${u.name}${u.title ? `, ${u.title}` : ''}${isAdmin(u) ? ' (admin)' : ''}. Teams: ${u.teams.map((t) => `${t.name} (${t.role})`).join(', ') || 'none'}.\n`;
    let full = false;
    for (const [title, lines] of sections) {
      if (full) break;
      context += `\n${title}:\n`;
      if (!lines.length) context += '(none)\n';
      for (const l of lines) {
        if (context.length + l.text.length > ASK_CONTEXT_CHARS) { context += '(more not shown)\n'; full = true; break; }
        context += `- ${l.text}\n`;
        if (l.ref) refs.set(l.ref[0], l.ref[1]);
      }
    }

    const r = await run(u, 'ask', [
      { role: 'system', content: `${BASE}
Answer the question using only the workspace data provided, which is everything this person can see. Today is ${now}.
If the answer isn't in the data, say you don't have that information rather than guessing.
When you mention a task, cite it as "#<number> <title>", for example "#12 Homepage banner".
Be brief: a sentence or two, or a few bullet points starting with "- ". Plain text: no Markdown tables, headings or bold.` },
      { role: 'user', content: `${data(context, 'workspace')}\n\nQuestion: ${question}` },
    ]);
    const cited: Record<string, string> = {};
    for (const m of r.text.matchAll(/#(\d+)/g)) {
      const taskId = refs.get(Number(m[1]));
      if (taskId) cited[m[1]] = taskId;
    }
    return { text: r.text, refs: cited };
  });
}
