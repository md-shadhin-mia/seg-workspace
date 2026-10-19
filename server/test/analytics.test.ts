import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, PW, makeUser, setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
let admin: Client;
let dev: string, mkt: string, webProject: string, mktProject: string;
let nadia: Awaited<ReturnType<typeof makeUser>>;   // Development lead
let tanvir: Awaited<ReturnType<typeof makeUser>>;  // Development member
let imran: Awaited<ReturnType<typeof makeUser>>;   // Development member
let walid: Awaited<ReturnType<typeof makeUser>>;   // Marketing member

/** Creates a task for `who` and backdates it: assigned `ago` days ago, due in `due` days, done `done` days ago. */
async function task(lead: Client, projectId: string, who: string, o: { ago: number; due?: number; done?: number; status?: string }) {
  const r = await lead.post('/api/tasks', { projectId, title: `Task ${Math.random()}`, assigneeIds: [who] });
  const sql = ctx.app.sql;
  await sql`update task_assignees set assigned_at = now() - ${o.ago + ' days'}::interval,
    status = ${o.done !== undefined ? 'done' : o.status ?? 'todo'},
    updated_at = now() - ${(o.done ?? 0) + ' days'}::interval where task_id = ${r.body.id}`;
  await sql`update tasks set due_date = ${o.due === undefined ? null : sql`current_date + ${o.due}::int`},
    status = ${o.done !== undefined ? 'done' : o.status ?? 'todo'},
    completed_at = ${o.done !== undefined ? sql`now() - ${o.done + ' days'}::interval` : null} where id = ${r.body.id}`;
  return r.body.id as string;
}

beforeAll(async () => {
  ctx = await setup();
  admin = new Client(ctx.app);
  await admin.post('/api/auth/register', { name: 'Farhana Chowdhury', email: 'farhana@seg.test', password: PW });
  const teams = (await admin.get('/api/teams')).body;
  dev = teams.find((t: any) => t.name === 'Development').id;
  mkt = teams.find((t: any) => t.name === 'Digital Marketing').id;
  nadia = await makeUser(ctx.app, admin, 'Nadia Karim', [{ teamId: dev, role: 'lead' }]);
  tanvir = await makeUser(ctx.app, admin, 'Tanvir Ahmed', [{ teamId: dev, role: 'member' }]);
  imran = await makeUser(ctx.app, admin, 'Imran Kabir', [{ teamId: dev, role: 'member' }]);
  walid = await makeUser(ctx.app, admin, 'Walid Hasan', [{ teamId: mkt, role: 'member' }]);
  webProject = (await nadia.client.post('/api/projects', { teamId: dev, name: 'Main Website' })).body.id;
  mktProject = (await admin.post('/api/projects', { teamId: mkt, name: 'Graphics' })).body.id;

  await task(nadia.client, webProject, tanvir.id, { ago: 10, due: -3, done: 4 });   // on time
  await task(nadia.client, webProject, tanvir.id, { ago: 10, due: -6, done: 2 });   // late
  await task(nadia.client, webProject, tanvir.id, { ago: 8, done: 1 });             // no due date
  await task(nadia.client, webProject, tanvir.id, { ago: 5, due: -1, status: 'in_progress' }); // overdue
  await task(nadia.client, webProject, imran.id, { ago: 3, due: 5, status: 'todo' });
  await task(admin, mktProject, walid.id, { ago: 3, due: 2, done: 1 });
});
afterAll(async () => { await ctx.app.close(); });

describe('analytics overview', () => {
  it('gives members their own numbers only', async () => {
    const r = await tanvir.client.get('/api/analytics/overview');
    expect(r.status).toBe(200);
    expect(r.body.view).toBe('personal');
    expect(r.body.views).toEqual(['personal']);
    expect(r.body.summary).toMatchObject({ completed: 3, completedWithDue: 2, onTime: 1, open: 1, overdue: 1, completionRate: 75, onTimeRate: 50 });
    expect(r.body.people).toEqual([]);
    expect(r.body.deadlines).toHaveLength(1);
    expect(r.body.contributions[0]).toMatchObject({ name: 'Main Website', completed: 3, open: 1 });
    expect((await tanvir.client.get('/api/analytics/overview?view=team')).status).toBe(403);
    expect((await tanvir.client.get('/api/analytics/overview?view=org')).status).toBe(403);
  });

  it('limits team leads to the teams they lead', async () => {
    const r = await nadia.client.get('/api/analytics/overview');
    expect(r.body.view).toBe('team');
    expect(r.body.teams.map((t: any) => t.name)).toEqual(['Development']);
    const names = r.body.people.map((p: any) => p.name);
    expect(names).toEqual(expect.arrayContaining(['Tanvir Ahmed', 'Imran Kabir']));
    expect(names).not.toContain('Walid Hasan');
    expect(r.body.summary.completed).toBe(3);
    expect(r.body.projects.map((p: any) => p.name)).toEqual(['Main Website']);
    expect(r.body.projects[0]).toMatchObject({ total: 5, done: 3, overdue: 1 });
    expect((await nadia.client.get(`/api/analytics/overview?teamId=${mkt}`)).status).toBe(404);
    expect((await nadia.client.get(`/api/analytics/overview?projectId=${mktProject}`)).status).toBe(404);
    const one = await nadia.client.get(`/api/analytics/overview?userId=${imran.id}`);
    expect(one.body.people.map((p: any) => p.name)).toEqual(['Imran Kabir']);
    expect(one.body.summary).toMatchObject({ completed: 0, open: 1 });
  });

  it('shows admins every team, filterable by department', async () => {
    expect((await nadia.client.patch(`/api/teams/${dev}`, { department: 'Tech' })).status).toBe(403);
    expect((await admin.patch(`/api/teams/${dev}`, { department: 'Tech' })).status).toBe(200);
    const all = await admin.get('/api/analytics/overview');
    expect(all.body.view).toBe('org');
    expect(all.body.teams).toHaveLength(2);
    expect(all.body.summary.completed).toBe(4);
    expect(all.body.filters.departments).toEqual(['Tech']);
    const tech = await admin.get('/api/analytics/overview?department=Tech');
    expect(tech.body.teams.map((t: any) => t.name)).toEqual(['Development']);
    expect(tech.body.summary.completed).toBe(3);
  });

  it('compares with the previous period and validates the range', async () => {
    const r = await tanvir.client.get('/api/analytics/overview?from=2020-01-01&to=2020-01-31');
    expect(r.body.summary.completed).toBe(0);
    expect(r.body.range.prevTo).toBe('2019-12-31');
    expect((await tanvir.client.get('/api/analytics/overview?from=2026-02-01&to=2026-01-01')).status).toBe(400);
    expect((await tanvir.client.get('/api/analytics/overview?from=2010-01-01&to=2026-01-01')).status).toBe(400);
  });
});

describe('person analytics', () => {
  it('lets people see themselves and leads see their team, nobody else', async () => {
    expect((await tanvir.client.get(`/api/analytics/people/${tanvir.id}`)).status).toBe(200);
    const r = await nadia.client.get(`/api/analytics/people/${tanvir.id}`);
    expect(r.status).toBe(200);
    expect(r.body.summary.completed).toBe(3);
    expect(r.body.scopeTeams).toEqual(['Development']);
    expect(r.body.recent).toHaveLength(3);
    expect((await nadia.client.get(`/api/analytics/people/${walid.id}`)).status).toBe(404);
    expect((await tanvir.client.get(`/api/analytics/people/${imran.id}`)).status).toBe(404);
    expect((await admin.get(`/api/analytics/people/${walid.id}`)).body.summary.completed).toBe(1);
  });
});

describe('project analytics', () => {
  it('summarises progress, people and delays for anyone in the team', async () => {
    const r = await tanvir.client.get(`/api/analytics/projects/${webProject}`);
    expect(r.status).toBe(200);
    expect(r.body.totals).toMatchObject({ total: 5, done: 3, overdue: 1, late: 1, pct: 60 });
    expect(r.body.members[0]).toMatchObject({ name: 'Tanvir Ahmed', assigned: 4, done: 3, overdue: 1, onTimeRate: 50 });
    expect(r.body.delayed).toHaveLength(2);
    expect(r.body.progress.at(-1)).toMatchObject({ total: 5, done: 3 });
    expect((await walid.client.get(`/api/analytics/projects/${webProject}`)).status).toBe(404);
  });
});

describe('scoring rules', () => {
  it('can only be changed by admins and is validated', async () => {
    const body = { weights: { completion: 50, onTime: 50, approval: 0, backlog: 0 }, targets: { completion: 90, onTime: 90, approval: 80, weeklyCompleted: 4 }, minSample: 2 };
    expect((await nadia.client.put('/api/analytics/settings', body)).status).toBe(403);
    expect((await admin.put('/api/analytics/settings', { ...body, weights: { completion: 0, onTime: 0, approval: 0, backlog: 0 } })).status).toBe(400);
    expect((await admin.put('/api/analytics/settings', body)).status).toBe(200);
    expect((await tanvir.client.get('/api/analytics/settings')).body).toEqual(body);
    const r = await tanvir.client.get('/api/analytics/overview');
    expect(r.body.summary.scoreParts.map((p: any) => p.key)).toEqual(['completion', 'onTime']);
    expect(r.body.summary.score).toBe(63); // (75*50 + 50*50) / 100, rounded
  });
});
