import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, PW, makeUser, setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
let admin: Client;
let dev: string, mkt: string;
let nadia: Awaited<ReturnType<typeof makeUser>>;   // Development lead
let tanvir: Awaited<ReturnType<typeof makeUser>>;  // Development member
let imran: Awaited<ReturnType<typeof makeUser>>;   // Development member
let walid: Awaited<ReturnType<typeof makeUser>>;   // Marketing member
let mamun: Awaited<ReturnType<typeof makeUser>>;   // Marketing lead
let webProject: string, mktProject: string, taskId: string;

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
  mamun = await makeUser(ctx.app, admin, 'Mamun Rahman', [{ teamId: mkt, role: 'lead' }]);
});
afterAll(async () => { await ctx.app.close(); });

describe('projects and team isolation', () => {
  it('lets team leads create projects, not members', async () => {
    expect((await tanvir.client.post('/api/projects', { teamId: dev, name: 'Sneaky' })).status).toBe(403);
    const r = await nadia.client.post('/api/projects', { teamId: dev, name: 'Main Website', dueDate: '2026-11-30' });
    expect(r.status).toBe(201);
    webProject = r.body.id;
    expect((await nadia.client.post('/api/projects', { teamId: mkt, name: 'Not my team' })).status).toBe(403);
    mktProject = (await mamun.client.post('/api/projects', { teamId: mkt, name: 'Graphics' })).body.id;
  });

  it('hides another team’s projects and tasks', async () => {
    await mamun.client.post('/api/tasks', { projectId: mktProject, title: 'Malaysia Campaign Banner', assigneeIds: [walid.id] });
    const walidProjects = (await walid.client.get('/api/projects')).body;
    expect(walidProjects.map((p: any) => p.name)).toEqual(['Graphics']);
    expect((await walid.client.get(`/api/projects/${webProject}`)).status).toBe(404);
    expect((await tanvir.client.get('/api/tasks')).body.some((t: any) => t.title.includes('Malaysia'))).toBe(false);
    expect((await walid.client.post('/api/tasks', { projectId: webProject, title: 'x' })).status).toBe(404);
    const teams = (await walid.client.get('/api/teams')).body;
    expect(teams.map((t: any) => t.name)).toEqual(['Digital Marketing']);
  });

  it('shows everything to admins', async () => {
    const all = (await admin.get('/api/tasks')).body;
    expect(all.length).toBeGreaterThan(0);
    expect((await admin.get('/api/projects')).body).toHaveLength(2);
  });
});

describe('tasks with several assignees', () => {
  it('creates a task assigned to several people and notifies them', async () => {
    const r = await nadia.client.post('/api/tasks', {
      projectId: webProject, title: 'Study Abroad Service Page', priority: 'high', dueDate: '2026-10-20',
      assigneeIds: [tanvir.id, imran.id, walid.id],
    });
    expect(r.status).toBe(201);
    taskId = r.body.id;
    const notes = (await walid.client.get('/api/notifications')).body;
    expect(notes.some((n: any) => n.type === 'assigned' && n.taskId === taskId)).toBe(true);
    expect(ctx.mailer.outbox.some((m) => m.to === walid.email && m.subject.includes('Study Abroad'))).toBe(true);
  });

  it('gives an assignee from another team full access to that task only', async () => {
    const t = await walid.client.get(`/api/tasks/${taskId}`);
    expect(t.status).toBe(200);
    expect(t.body.assignees).toHaveLength(3);
    expect(t.body.perms).toMatchObject({ edit: true, manage: false, openProject: false, setStatusFor: [walid.id] });
    expect((await walid.client.get(`/api/projects/${webProject}`)).status).toBe(404);
    const mine = (await walid.client.get('/api/tasks?view=mine')).body;
    expect(mine.map((x: any) => x.title)).toContain('Study Abroad Service Page');
    expect((await walid.client.patch(`/api/tasks/${taskId}`, { description: 'Walid added the brief.' })).status).toBe(200);
    expect((await walid.client.post(`/api/tasks/${taskId}/comments`, { body: 'Hero image is in the Drive.' })).status).toBe(201);
  });

  it('lets each assignee change only their own status', async () => {
    expect((await tanvir.client.patch(`/api/tasks/${taskId}/assignees/${tanvir.id}`, { status: 'in_progress' })).body.taskStatus).toBe('in_progress');
    expect((await tanvir.client.patch(`/api/tasks/${taskId}/assignees/${imran.id}`, { status: 'done' })).status).toBe(403);
    expect((await tanvir.client.patch(`/api/tasks/${taskId}/assignees/${tanvir.id}`, { status: 'changes' })).status).toBe(403);
  });

  it('lets the team lead change anyone’s status', async () => {
    const r = await nadia.client.patch(`/api/tasks/${taskId}/assignees/${imran.id}`, { status: 'in_progress' });
    expect(r.status).toBe(200);
    expect((await imran.client.get('/api/notifications')).body.some((n: any) => n.type === 'status')).toBe(true);
  });

  it('derives the task status from everyone’s status', async () => {
    await tanvir.client.patch(`/api/tasks/${taskId}/assignees/${tanvir.id}`, { status: 'done' });
    await imran.client.patch(`/api/tasks/${taskId}/assignees/${imran.id}`, { status: 'done' });
    let t = (await nadia.client.get(`/api/tasks/${taskId}`)).body;
    expect(t.status).toBe('in_progress'); // Walid is still To Do
    await walid.client.patch(`/api/tasks/${taskId}/assignees/${walid.id}`, { status: 'done' });
    t = (await nadia.client.get(`/api/tasks/${taskId}`)).body;
    expect(t.status).toBe('done');
    expect(t.completedAt).toBeTruthy();
    await nadia.client.patch(`/api/tasks/${taskId}/assignees/${walid.id}`, { status: 'in_progress' });
    expect((await nadia.client.get(`/api/tasks/${taskId}`)).body.status).toBe('in_progress');
  });

  it('only lets leads and the creator change who is assigned', async () => {
    expect((await tanvir.client.put(`/api/tasks/${taskId}/assignees`, { userIds: [tanvir.id] })).status).toBe(403);
    const r = await nadia.client.put(`/api/tasks/${taskId}/assignees`, { userIds: [tanvir.id, imran.id] });
    expect(r.status).toBe(200);
    expect((await walid.client.get(`/api/tasks/${taskId}`)).status).toBe(404); // access ends with the assignment
  });

  it('keeps non-assignee team members read-and-comment only', async () => {
    const t = await nadia.client.post('/api/tasks', { projectId: webProject, title: 'Hero redesign', assigneeIds: [tanvir.id] });
    const view = await imran.client.get(`/api/tasks/${t.body.id}`);
    expect(view.status).toBe(200);
    expect(view.body.perms.edit).toBe(false);
    expect((await imran.client.patch(`/api/tasks/${t.body.id}`, { title: 'Hijack' })).status).toBe(403);
    expect((await imran.client.post(`/api/tasks/${t.body.id}/comments`, { body: 'Looks good' })).status).toBe(201);
  });
});

describe('submissions and review', () => {
  let reviewTask: string;
  it('records versions per assignee and moves their status to review', async () => {
    reviewTask = (await nadia.client.post('/api/tasks', { projectId: webProject, title: 'Hero section', assigneeIds: [tanvir.id, imran.id] })).body.id;
    expect((await nadia.client.post(`/api/tasks/${reviewTask}/submissions`, { links: [{ url: 'https://x.dev' }] })).status).toBe(403);
    expect((await tanvir.client.post(`/api/tasks/${reviewTask}/submissions`, {})).status).toBe(400);
    const r = await tanvir.client.post(`/api/tasks/${reviewTask}/submissions`, {
      note: 'Tested on mobile', links: [{ url: 'staging.seg.dev/hero' }, { url: 'https://github.com/seg/web/pull/214', title: 'PR #214' }],
    });
    expect(r.status).toBe(201);
    expect(r.body.version).toBe(1);
    expect((await tanvir.client.post(`/api/tasks/${reviewTask}/submissions`, { links: [{ url: 'https://a.dev' }] })).status).toBe(400);
    const t = (await nadia.client.get(`/api/tasks/${reviewTask}`)).body;
    expect(t.assignees.find((a: any) => a.id === tanvir.id).status).toBe('review');
    expect(t.submissions[0].items.map((i: any) => i.url)).toContain('https://staging.seg.dev/hero');
    expect((await nadia.client.get('/api/notifications')).body.some((n: any) => n.type === 'review_requested' && n.taskId === reviewTask)).toBe(true);
    expect((await nadia.client.get('/api/dashboard')).body.reviewQueue).toHaveLength(1);
  });

  it('requires feedback for changes, then accepts a second version and approval', async () => {
    const sub = (await nadia.client.get(`/api/tasks/${reviewTask}`)).body.submissions[0];
    expect((await imran.client.post(`/api/submissions/${sub.id}/review`, { decision: 'approve' })).status).toBe(403);
    expect((await nadia.client.post(`/api/submissions/${sub.id}/review`, { decision: 'changes' })).status).toBe(400);
    expect((await nadia.client.post(`/api/submissions/${sub.id}/review`, { decision: 'changes', feedback: 'Logo too small' })).body.taskStatus).toBe('changes');
    const v2 = await tanvir.client.post(`/api/tasks/${reviewTask}/submissions`, { links: [{ url: 'https://staging.seg.dev/hero2' }] });
    expect(v2.body.version).toBe(2);
    const subs = (await nadia.client.get(`/api/tasks/${reviewTask}`)).body.submissions;
    expect(subs.map((s: any) => s.state)).toEqual(['pending', 'changes']);
    await nadia.client.post(`/api/submissions/${subs[0].id}/review`, { decision: 'approve' });
    const t = (await nadia.client.get(`/api/tasks/${reviewTask}`)).body;
    expect(t.assignees.find((a: any) => a.id === tanvir.id).status).toBe('done');
    expect(t.status).toBe('in_progress'); // Imran has not finished
    expect((await tanvir.client.get('/api/notifications')).body.some((n: any) => n.type === 'approved')).toBe(true);
  });
});

describe('files, checklist, mentions', () => {
  it('uploads, serves and protects files', async () => {
    const boundary = '----seg';
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="brief.txt"\r\nContent-Type: text/plain\r\n\r\nhello brief\r\n--${boundary}--\r\n`;
    const up = await tanvir.client.req('POST', `/api/tasks/${taskId}/files?purpose=resource`, payload, { 'content-type': `multipart/form-data; boundary=${boundary}` });
    expect(up.status).toBe(201);
    const fileId = up.body[0].id;
    const dl = await imran.client.get(`/api/files/${fileId}`);
    expect(dl.status).toBe(200);
    expect(dl.raw.body).toBe('hello brief');
    expect(dl.raw.headers['x-content-type-options']).toBe('nosniff');
    expect((await walid.client.get(`/api/files/${fileId}`)).status).toBe(404);
    const svg = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.svg"\r\nContent-Type: image/svg+xml\r\n\r\n<svg onload="alert(1)"/>\r\n--${boundary}--\r\n`;
    const s = await tanvir.client.req('POST', `/api/tasks/${taskId}/files`, svg, { 'content-type': `multipart/form-data; boundary=${boundary}` });
    const sv = await tanvir.client.get(`/api/files/${s.body[0].id}`);
    expect(sv.raw.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('rejects files over the size limit', async () => {
    const boundary = '----seg';
    const big = 'x'.repeat(1024 * 1024 + 10);
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\nContent-Type: application/octet-stream\r\n\r\n${big}\r\n--${boundary}--\r\n`;
    const up = await tanvir.client.req('POST', `/api/tasks/${taskId}/files`, payload, { 'content-type': `multipart/form-data; boundary=${boundary}` });
    expect(up.status).toBe(413);
  });

  it('manages checklist items for people who can edit', async () => {
    const item = await tanvir.client.post(`/api/tasks/${taskId}/checklist`, { text: 'Responsive pass' });
    expect(item.status).toBe(201);
    expect((await tanvir.client.patch(`/api/checklist/${item.body.id}`, { done: true })).status).toBe(200);
    expect((await walid.client.patch(`/api/checklist/${item.body.id}`, { done: false })).status).toBe(404);
    const t = (await tanvir.client.get(`/api/tasks/${taskId}`)).body;
    expect(t.checklist[0].done).toBe(true);
  });

  it('notifies mentioned people only when they can see the task', async () => {
    const before = (await walid.client.get('/api/notifications')).body.length;
    await tanvir.client.post(`/api/tasks/${taskId}/comments`, { body: '@Imran and @Walid please check', mentions: [imran.id, walid.id] });
    expect((await imran.client.get('/api/notifications')).body[0].type).toBe('mention');
    expect((await walid.client.get('/api/notifications')).body.length).toBe(before);
  });

  it('finds tasks with search, scoped to what the user can see', async () => {
    expect((await tanvir.client.get('/api/search?q=study')).body.tasks).toHaveLength(1);
    expect((await walid.client.get('/api/search?q=study')).body.tasks).toHaveLength(0);
  });

  it('records a readable activity history', async () => {
    const a = (await nadia.client.get(`/api/tasks/${taskId}/activity`)).body;
    const actions = a.items.map((i: any) => i.action);
    expect(actions).toEqual(expect.arrayContaining(['created', 'assigned', 'status', 'unassigned', 'file_added', 'checked']));
    expect(Object.values(a.names)).toContain('Walid Hasan');
  });
});
