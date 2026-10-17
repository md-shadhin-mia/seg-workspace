import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { canManageTeam, canSeeTeam, deriveStatus, isAdmin, taskAccess, visibleTaskCond, type TaskAccess } from '../lib/access.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { logActivity, notify } from '../lib/events.js';
import { parse, requireUser, uuid } from '../lib/http.js';
import { PRIORITIES, STATUSES, type SessionUser, type Status } from '../lib/types.js';
import type { Sql } from '../db.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');
const url = z.string().trim().max(2000).transform((s) => (/^https?:\/\//i.test(s) ? s : `https://${s}`))
  .refine((s) => { try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) && u.hostname.includes('.'); } catch { return false; } }, 'Enter a valid link');
const STATUS_LABEL: Record<Status, string> = { todo: 'To Do', in_progress: 'In Progress', review: 'Ready for Review', changes: 'Changes Requested', done: 'Done' };

export default async function taskRoutes(app: FastifyInstance) {
  const { sql, cfg, mail } = app;
  const ctx = { sql, cfg, mail, log: (o: unknown, m?: string) => app.log.warn(o, m) };

  /** Recomputes the overall status from assignee statuses. Returns the new status. */
  async function syncStatus(db: Sql, taskId: string): Promise<Status> {
    const [t] = await db`select status from tasks where id = ${taskId}`;
    const rows = await db`select status from task_assignees where task_id = ${taskId}`;
    const next = deriveStatus(rows.map((r) => r.status as Status), t.status);
    if (next !== t.status) {
      await db`update tasks set status = ${next}, updated_at = now(),
        completed_at = case when ${next} = 'done' then now() else null end where id = ${taskId}`;
    }
    return next;
  }

  /** Who reviews a task: its reviewer if set, otherwise the team's leads. */
  async function reviewersOf(task: TaskAccess['task']): Promise<string[]> {
    if (task.reviewerId) return [task.reviewerId];
    const leads = await sql`select user_id from team_members where team_id = ${task.teamId} and role = 'lead'`;
    return leads.map((l) => l.userId);
  }

  async function activeUsers(ids: string[]) {
    if (!ids.length) return [];
    const rows = await sql`select id, name from users where id = any(${sql.array(ids)}::uuid[]) and status = 'active'`;
    if (rows.length !== new Set(ids).size) throw badRequest('One of the people you picked is not an active user.');
    return rows;
  }

  // ---------- list ----------
  app.get('/tasks', async (req) => {
    const u = requireUser(req);
    const q = parse(z.object({
      view: z.enum(['mine', 'all']).default('all'),
      projectId: uuid.optional(),
      teamId: uuid.optional(),
      status: z.enum(STATUSES as [Status, ...Status[]]).optional(),
      q: z.string().trim().max(100).optional(),
    }), req.query);
    return sql`
      select t.id, t.seq, t.title, t.status, t.priority, t.due_date, t.project_id, p.name as project_name,
        p.team_id, tm.name as team_name, t.updated_at, t.created_at,
        coalesce((select json_agg(json_build_object('userId', a.user_id, 'name', au.name, 'status', a.status) order by a.assigned_at)
          from task_assignees a join users au on au.id = a.user_id where a.task_id = t.id), '[]') as assignees,
        (select a.status from task_assignees a where a.task_id = t.id and a.user_id = ${u.id}) as my_status,
        (select count(*)::int from checklist_items c where c.task_id = t.id) as checklist_total,
        (select count(*)::int from checklist_items c where c.task_id = t.id and c.done) as checklist_done,
        (select count(*)::int from comments c where c.task_id = t.id) as comment_count
      from tasks t join projects p on p.id = t.project_id join teams tm on tm.id = p.team_id
      where p.archived_at is null and ${visibleTaskCond(sql, u)}
        ${q.view === 'mine' ? sql`and exists (select 1 from task_assignees a where a.task_id = t.id and a.user_id = ${u.id})` : sql``}
        ${q.projectId ? sql`and t.project_id = ${q.projectId}` : sql``}
        ${q.teamId ? sql`and p.team_id = ${q.teamId}` : sql``}
        ${q.status ? sql`and t.status = ${q.status}` : sql``}
        ${q.q ? sql`and t.title ilike ${'%' + q.q.replace(/[%_\\]/g, '\\$&') + '%'}` : sql``}
      order by (t.status = 'done'), t.due_date asc nulls last, t.seq desc
      limit 500`;
  });

  // ---------- create ----------
  app.post('/tasks', async (req, reply) => {
    const u = requireUser(req);
    const body = parse(z.object({
      projectId: uuid,
      title: z.string().trim().min(1, 'Give the task a title').max(200),
      description: z.string().max(20000).default(''),
      priority: z.enum(PRIORITIES).default('medium'),
      dueDate: date.nullable().optional(),
      assigneeIds: z.array(uuid).max(20).default([]),
      reviewerId: uuid.nullable().optional(),
    }), req.body);
    const [p] = await sql`select id, team_id, name, archived_at from projects where id = ${body.projectId}`;
    if (!p || !canSeeTeam(u, p.teamId) || p.archivedAt) throw notFound('Project not found.');
    const people = await activeUsers([...new Set(body.assigneeIds)]);
    if (body.reviewerId) await activeUsers([body.reviewerId]);
    const task = await sql.begin(async (tx) => {
      const [t] = await tx`
        insert into tasks (project_id, title, description, priority, due_date, reviewer_id, created_by)
        values (${p.id}, ${body.title}, ${body.description}, ${body.priority}, ${body.dueDate ?? null}, ${body.reviewerId ?? null}, ${u.id})
        returning id, seq`;
      for (const a of people) await tx`insert into task_assignees (task_id, user_id, assigned_by) values (${t.id}, ${a.id}, ${u.id})`;
      await tx`insert into activity (task_id, actor_id, action, meta) values (${t.id}, ${u.id}, 'created', '{}')`;
      if (people.length) {
        await tx`insert into activity (task_id, actor_id, action, meta) values (${t.id}, ${u.id}, 'assigned', ${tx.json({ userIds: people.map((x) => x.id) })})`;
      }
      return t;
    });
    await notify(ctx, { userIds: people.map((x) => x.id), type: 'assigned', taskId: task.id, actorId: u.id,
      body: `${u.name} assigned you "${body.title}" in ${p.name}.`, subject: `New task: ${body.title}` });
    return reply.status(201).send(task);
  });

  // ---------- detail ----------
  app.get('/tasks/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const acc = await taskAccess(sql, u, id);
    const t = acc.task;
    const [assignees, checklist, links, files, subs, items, people] = await Promise.all([
      sql`select a.user_id as id, u.name, u.title, u.email, a.status, a.updated_at, a.assigned_at
          from task_assignees a join users u on u.id = a.user_id where a.task_id = ${id} order by a.assigned_at`,
      sql`select id, text, done, position from checklist_items where task_id = ${id} order by position, created_at`,
      sql`select l.id, l.title, l.url, l.created_at, l.added_by, u.name as added_by_name from links l left join users u on u.id = l.added_by where l.task_id = ${id} order by l.created_at`,
      sql`select f.id, f.name, f.mime, f.size, f.created_at, f.uploader_id, u.name as uploader_name from files f left join users u on u.id = f.uploader_id
          where f.task_id = ${id} and f.purpose = 'resource' order by f.created_at`,
      sql`select s.id, s.user_id, s.version, s.note, s.state, s.feedback, s.created_at, s.reviewed_at, s.reviewed_by, r.name as reviewed_by_name
          from submissions s left join users r on r.id = s.reviewed_by where s.task_id = ${id} order by s.user_id, s.version desc`,
      sql`select i.submission_id, i.id, i.kind, i.title, i.url, f.id as file_id, f.mime, f.size
          from submission_items i join submissions s on s.id = i.submission_id left join files f on f.id = i.file_id where s.task_id = ${id}`,
      sql`select id, name from users where id = any(${sql.array([t.reviewerId, t.createdBy].filter(Boolean) as string[])}::uuid[])`,
    ]);
    const nameOf = (uid: string | null) => people.find((x) => x.id === uid)?.name ?? null;
    const [{ comments }] = await sql`select count(*)::int as comments from comments where task_id = ${id}`;
    const reviewers = await reviewersOf(t);
    return {
      id: t.id, seq: t.seq, title: t.title, description: t.description, priority: t.priority, status: t.status,
      dueDate: t.dueDate, createdAt: t.createdAt, updatedAt: t.updatedAt, completedAt: t.completedAt,
      project: { id: t.projectId, name: t.projectName }, team: { id: t.teamId, name: t.teamName },
      reviewer: t.reviewerId ? { id: t.reviewerId, name: nameOf(t.reviewerId) } : null,
      reviewerIds: reviewers,
      createdBy: t.createdBy ? { id: t.createdBy, name: nameOf(t.createdBy) } : null,
      assignees,
      checklist,
      resources: { links, files },
      submissions: subs.map((s) => ({ ...s, items: items.filter((i) => i.submissionId === s.id) })),
      commentCount: comments,
      perms: { ...acc.perms, review: acc.perms.review || reviewers.includes(u.id) },
    };
  });

  // ---------- update ----------
  app.patch('/tasks/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const acc = await taskAccess(sql, u, id);
    const body = parse(z.object({
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(20000).optional(),
      priority: z.enum(PRIORITIES).optional(),
      dueDate: date.nullable().optional(),
      reviewerId: uuid.nullable().optional(),
      status: z.enum(STATUSES as [Status, ...Status[]]).optional(),
    }), req.body);
    if (!acc.perms.edit) throw forbidden('Only assignees, the creator and team leads can edit this task.');
    if (body.reviewerId !== undefined && !acc.perms.manage) throw forbidden('Only team leads and the creator can change the reviewer.');
    if (body.reviewerId) await activeUsers([body.reviewerId]);
    if (body.status && acc.assignees.length) throw badRequest('This task has assignees. Each person updates their own status.');
    await sql`
      update tasks set
        title = coalesce(${body.title ?? null}, title),
        description = coalesce(${body.description ?? null}, description),
        priority = coalesce(${body.priority ?? null}, priority),
        due_date = case when ${body.dueDate !== undefined} then ${body.dueDate ?? null}::date else due_date end,
        reviewer_id = case when ${body.reviewerId !== undefined} then ${body.reviewerId ?? null}::uuid else reviewer_id end,
        status = coalesce(${body.status ?? null}, status),
        completed_at = case when ${body.status ?? null}::text = 'done' then now() when ${body.status ?? null}::text is not null then null else completed_at end,
        updated_at = now()
      where id = ${id}`;
    const fields = Object.keys(body).filter((k) => k !== 'description' || body.description !== acc.task.description);
    if (fields.length) await logActivity(sql, id, u.id, 'updated', { fields, ...(body.status ? { to: body.status } : {}) });
    return { ok: true };
  });

  app.delete('/tasks/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const acc = await taskAccess(sql, u, id);
    if (!acc.perms.manage) throw forbidden('Only team leads and the creator can delete this task.');
    await sql`delete from tasks where id = ${id}`;
    return { ok: true };
  });

  // ---------- assignees ----------
  app.put('/tasks/:id/assignees', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { userIds } = parse(z.object({ userIds: z.array(uuid).max(20) }), req.body);
    const acc = await taskAccess(sql, u, id);
    if (!acc.perms.manage) throw forbidden('Only team leads and the task creator can change who is assigned.');
    const wanted = [...new Set(userIds)];
    await activeUsers(wanted);
    const current = acc.assignees.map((a) => a.userId);
    const added = wanted.filter((x) => !current.includes(x));
    const removed = current.filter((x) => !wanted.includes(x));
    await sql.begin(async (tx) => {
      if (removed.length) await tx`delete from task_assignees where task_id = ${id} and user_id = any(${tx.array(removed)}::uuid[])`;
      for (const a of added) await tx`insert into task_assignees (task_id, user_id, assigned_by) values (${id}, ${a}, ${u.id})`;
      if (added.length) await tx`insert into activity (task_id, actor_id, action, meta) values (${id}, ${u.id}, 'assigned', ${tx.json({ userIds: added })})`;
      if (removed.length) await tx`insert into activity (task_id, actor_id, action, meta) values (${id}, ${u.id}, 'unassigned', ${tx.json({ userIds: removed })})`;
      await syncStatus(tx as unknown as Sql, id);
    });
    await notify(ctx, { userIds: added, type: 'assigned', taskId: id, actorId: u.id,
      body: `${u.name} assigned you "${acc.task.title}" in ${acc.task.projectName}.`, subject: `New task: ${acc.task.title}` });
    return { ok: true };
  });

  app.patch('/tasks/:id/assignees/:userId', async (req) => {
    const u = requireUser(req);
    const { id, userId } = parse(z.object({ id: z.string(), userId: uuid }), req.params);
    const { status } = parse(z.object({ status: z.enum(STATUSES as [Status, ...Status[]]) }), req.body);
    const acc = await taskAccess(sql, u, id);
    const a = acc.assignees.find((x) => x.userId === userId);
    if (!a) throw notFound('That person is not assigned to this task.');
    if (!acc.perms.setStatusFor.includes(userId)) throw forbidden('You can only change your own status on this task.');
    const lead = canManageTeam(u, acc.task.teamId);
    if (status === 'changes' && !lead && !acc.perms.review) throw forbidden('Only reviewers can mark work as needing changes.');
    if (a.status === status) return { ok: true, taskStatus: acc.task.status };
    let taskStatus: Status = acc.task.status;
    await sql.begin(async (tx) => {
      await tx`update task_assignees set status = ${status}, updated_at = now() where task_id = ${id} and user_id = ${userId}`;
      await tx`insert into activity (task_id, actor_id, action, meta) values (${id}, ${u.id}, 'status', ${tx.json({ userId, from: a.status, to: status })})`;
      taskStatus = await syncStatus(tx as unknown as Sql, id);
    });
    if (status === 'review') {
      await notify(ctx, { userIds: await reviewersOf(acc.task), type: 'review_requested', taskId: id, actorId: u.id,
        body: `${u.name} marked "${acc.task.title}" as ready for review.`, subject: `Ready for review: ${acc.task.title}` });
    } else if (userId !== u.id) {
      await notify(ctx, { userIds: [userId], type: 'status', taskId: id, actorId: u.id,
        body: `${u.name} set your status on "${acc.task.title}" to ${STATUS_LABEL[status]}.` });
    }
    return { ok: true, taskStatus };
  });

  // ---------- checklist ----------
  app.post('/tasks/:id/checklist', async (req, reply) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(300) }), req.body);
    const acc = await taskAccess(sql, u, id);
    if (!acc.perms.edit) throw forbidden();
    const [item] = await sql`
      insert into checklist_items (task_id, text, position, created_by)
      values (${id}, ${text}, coalesce((select max(position) + 1 from checklist_items where task_id = ${id}), 0), ${u.id})
      returning id, text, done, position`;
    return reply.status(201).send(item);
  });

  async function checklistAccess(u: SessionUser, itemId: string) {
    const [item] = await sql`select task_id, text from checklist_items where id = ${itemId}`;
    if (!item) throw notFound('Checklist item not found.');
    const acc = await taskAccess(sql, u, item.taskId);
    if (!acc.perms.edit) throw forbidden();
    return item;
  }

  app.patch('/checklist/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ text: z.string().trim().min(1).max(300).optional(), done: z.boolean().optional() }), req.body);
    const item = await checklistAccess(u, id);
    await sql`update checklist_items set text = coalesce(${body.text ?? null}, text), done = coalesce(${body.done ?? null}, done) where id = ${id}`;
    if (body.done !== undefined) await logActivity(sql, item.taskId, u.id, body.done ? 'checked' : 'unchecked', { text: item.text });
    return { ok: true };
  });

  app.delete('/checklist/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    await checklistAccess(u, id);
    await sql`delete from checklist_items where id = ${id}`;
    return { ok: true };
  });

  // ---------- resource links ----------
  app.post('/tasks/:id/links', async (req, reply) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ url, title: z.string().trim().max(200).optional() }), req.body);
    const acc = await taskAccess(sql, u, id);
    if (!acc.perms.edit) throw forbidden();
    const title = body.title || new URL(body.url).hostname.replace(/^www\./, '');
    const [l] = await sql`insert into links (task_id, added_by, title, url) values (${id}, ${u.id}, ${title}, ${body.url}) returning id, title, url, created_at`;
    await logActivity(sql, id, u.id, 'link_added', { title });
    return reply.status(201).send(l);
  });

  app.delete('/links/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const [l] = await sql`select task_id from links where id = ${id}`;
    if (!l) throw notFound();
    const acc = await taskAccess(sql, u, l.taskId);
    if (!acc.perms.edit) throw forbidden();
    await sql`delete from links where id = ${id}`;
    return { ok: true };
  });

  // ---------- comments ----------
  app.get('/tasks/:id/comments', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    await taskAccess(sql, u, id);
    return sql`select c.id, c.body, c.created_at, c.edited_at, c.author_id, u.name as author_name
      from comments c left join users u on u.id = c.author_id where c.task_id = ${id} order by c.created_at`;
  });

  app.post('/tasks/:id/comments', async (req, reply) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ body: z.string().trim().min(1, 'Write something first').max(5000), mentions: z.array(uuid).max(20).default([]) }), req.body);
    const acc = await taskAccess(sql, u, id);
    const [c] = await sql`insert into comments (task_id, author_id, body) values (${id}, ${u.id}, ${body.body}) returning id, body, created_at`;
    // Only people who can already see the task get a mention notification.
    const mentioned: string[] = [];
    if (body.mentions.length) {
      const rows = await sql`
        select u.id from users u where u.id = any(${sql.array(body.mentions)}::uuid[]) and u.status = 'active' and (
          u.role = 'admin'
          or exists (select 1 from team_members m where m.user_id = u.id and m.team_id = ${acc.task.teamId})
          or exists (select 1 from task_assignees a where a.user_id = u.id and a.task_id = ${id}))`;
      mentioned.push(...rows.map((r) => r.id));
    }
    const snippet = body.body.length > 140 ? body.body.slice(0, 137) + '…' : body.body;
    await notify(ctx, { userIds: mentioned, type: 'mention', taskId: id, actorId: u.id, body: `${u.name} mentioned you on "${acc.task.title}": ${snippet}`, subject: `${u.name} mentioned you` });
    const watchers = [...acc.assignees.map((a) => a.userId), ...(await reviewersOf(acc.task)), acc.task.createdBy].filter((x): x is string => !!x && !mentioned.includes(x));
    await notify(ctx, { userIds: watchers, type: 'comment', taskId: id, actorId: u.id, body: `${u.name} commented on "${acc.task.title}": ${snippet}` });
    return reply.status(201).send({ ...c, authorId: u.id, authorName: u.name });
  });

  app.delete('/comments/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const [c] = await sql`select author_id, task_id from comments where id = ${id}`;
    if (!c) throw notFound();
    await taskAccess(sql, u, c.taskId);
    if (c.authorId !== u.id && !isAdmin(u)) throw forbidden('You can only delete your own comments.');
    await sql`delete from comments where id = ${id}`;
    return { ok: true };
  });

  // ---------- submissions & review ----------
  app.post('/tasks/:id/submissions', async (req, reply) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({
      note: z.string().trim().max(5000).default(''),
      links: z.array(z.object({ url, title: z.string().trim().max(200).optional() })).max(20).default([]),
      fileIds: z.array(uuid).max(20).default([]),
    }), req.body);
    const acc = await taskAccess(sql, u, id);
    if (!acc.isAssignee) throw forbidden('Only people assigned to this task can submit work.');
    if (!body.links.length && !body.fileIds.length) throw badRequest('Add at least one file or link to submit.');
    const files = body.fileIds.length
      ? await sql`select id, name from files where id = any(${sql.array(body.fileIds)}::uuid[]) and task_id = ${id} and uploader_id = ${u.id} and purpose = 'submission'`
      : [];
    if (files.length !== new Set(body.fileIds).size) throw badRequest('One of the files could not be found. Upload it again.');
    const [pending] = await sql`select 1 from submissions where task_id = ${id} and user_id = ${u.id} and state = 'pending'`;
    if (pending) throw badRequest('Your last version is still waiting for review.');
    let version = 0;
    let taskStatus: Status = acc.task.status;
    const sub = await sql.begin(async (tx) => {
      const [{ v }] = await tx`select coalesce(max(version), 0) + 1 as v from submissions where task_id = ${id} and user_id = ${u.id}`;
      version = v;
      const [s] = await tx`insert into submissions (task_id, user_id, version, note) values (${id}, ${u.id}, ${v}, ${body.note}) returning id`;
      for (const l of body.links) {
        await tx`insert into submission_items (submission_id, kind, title, url) values (${s.id}, 'link', ${l.title || new URL(l.url).hostname.replace(/^www\./, '')}, ${l.url})`;
      }
      for (const f of files) await tx`insert into submission_items (submission_id, kind, title, file_id) values (${s.id}, 'file', ${f.name}, ${f.id})`;
      await tx`update task_assignees set status = 'review', updated_at = now() where task_id = ${id} and user_id = ${u.id}`;
      await tx`insert into activity (task_id, actor_id, action, meta) values (${id}, ${u.id}, 'submitted', ${tx.json({ version: v })})`;
      taskStatus = await syncStatus(tx as unknown as Sql, id);
      return s;
    });
    await notify(ctx, { userIds: await reviewersOf(acc.task), type: 'review_requested', taskId: id, actorId: u.id,
      body: `${u.name} submitted version ${version} of "${acc.task.title}" for review.`, subject: `Review requested: ${acc.task.title}` });
    return reply.status(201).send({ id: sub.id, version, taskStatus });
  });

  app.post('/submissions/:id/review', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ decision: z.enum(['approve', 'changes']), feedback: z.string().trim().max(5000).optional() }), req.body);
    const [s] = await sql`select id, task_id, user_id, version, state from submissions where id = ${id}`;
    if (!s) throw notFound('Submission not found.');
    const acc = await taskAccess(sql, u, s.taskId);
    const reviewers = await reviewersOf(acc.task);
    if (!acc.perms.review && !reviewers.includes(u.id)) throw forbidden('Only the reviewer or a team lead can review this work.');
    if (s.userId === u.id && !isAdmin(u)) throw forbidden('Someone else needs to review your own work.');
    if (s.state !== 'pending') throw badRequest('This version has already been reviewed.');
    if (body.decision === 'changes' && !body.feedback) throw badRequest('Say what needs to change so they can fix it.');
    const next: Status = body.decision === 'approve' ? 'done' : 'changes';
    let taskStatus: Status = acc.task.status;
    await sql.begin(async (tx) => {
      await tx`update submissions set state = ${body.decision === 'approve' ? 'approved' : 'changes'}, feedback = ${body.feedback ?? null},
        reviewed_by = ${u.id}, reviewed_at = now() where id = ${id}`;
      await tx`update task_assignees set status = ${next}, updated_at = now() where task_id = ${s.taskId} and user_id = ${s.userId}`;
      await tx`insert into activity (task_id, actor_id, action, meta) values (${s.taskId}, ${u.id}, ${body.decision === 'approve' ? 'approved' : 'changes_requested'}, ${tx.json({ userId: s.userId, version: s.version })})`;
      taskStatus = await syncStatus(tx as unknown as Sql, s.taskId);
    });
    await notify(ctx, {
      userIds: [s.userId], taskId: s.taskId, actorId: u.id,
      type: body.decision === 'approve' ? 'approved' : 'changes_requested',
      body: body.decision === 'approve'
        ? `${u.name} approved version ${s.version} of "${acc.task.title}".`
        : `${u.name} requested changes on version ${s.version} of "${acc.task.title}": ${body.feedback}`,
      subject: body.decision === 'approve' ? `Approved: ${acc.task.title}` : `Changes requested: ${acc.task.title}`,
    });
    return { ok: true, taskStatus };
  });

  // ---------- activity ----------
  app.get('/tasks/:id/activity', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    await taskAccess(sql, u, id);
    const rows = await sql`select a.id, a.action, a.meta, a.created_at, a.actor_id, u.name as actor_name
      from activity a left join users u on u.id = a.actor_id where a.task_id = ${id} order by a.created_at, a.id`;
    const ids = [...new Set(rows.flatMap((r) => [r.meta?.userId, ...(r.meta?.userIds ?? [])]).filter(Boolean))] as string[];
    const names = ids.length ? await sql`select id, name from users where id = any(${sql.array(ids)}::uuid[])` : [];
    return { items: rows, names: Object.fromEntries(names.map((n) => [n.id, n.name])) };
  });
}
