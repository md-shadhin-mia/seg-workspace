import { expect, test, type Page } from '@playwright/test';

// The server talks to e2e/mock-openrouter.mjs instead of OpenRouter (see playwright.config.ts).
const ADMIN = { email: 'admin@e2e.test', password: 'admin-password-123' };
const MOCK = `http://localhost:${process.env.E2E_MOCK_AI_PORT ?? 3199}`;
const headers = { 'x-requested-with': 'seg-web' };

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Good');
}

test('a lead drafts a project plan with AI, adjusts it, and creates the project with the chosen tasks', async ({ page }) => {
  await signIn(page);
  const teams = await (await page.request.get('/api/teams')).json();
  const dev = teams.find((t: any) => t.name === 'Development').id;
  const rafi = await (await page.request.post('/api/users', { headers, data: { name: 'Rafi Islam', email: 'rafi@e2e.test', title: 'Frontend Developer', teams: [{ teamId: dev, role: 'member' }] } })).json();

  await page.getByRole('button', { name: 'Create a project' }).click();
  const form = page.getByRole('dialog', { name: 'New project' });
  await form.getByRole('tab', { name: 'Draft a plan with AI' }).click();
  await form.getByLabel('Project name').fill('Spring Admissions Landing');
  await form.getByLabel('Team').selectOption({ label: 'Development' });
  await form.getByLabel('Brief').fill('A landing page for the spring intake that collects enquiries before the education fair.');
  await form.getByRole('button', { name: 'Generate plan' }).click();

  // Preview: nothing has been created yet.
  const plan = page.getByRole('dialog', { name: 'Plan for Spring Admissions Landing' });
  await expect(plan.getByText('Design the landing page hero')).toBeVisible();
  await expect(plan.getByText('Collect enquiries for the spring intake')).toBeVisible();
  expect((await (await page.request.get('/api/projects')).json()).map((p: any) => p.name)).not.toContain('Spring Admissions Landing');

  // The server kept the real team member, dropped the outsider and the date in the past.
  await expect(plan.getByLabel('Assignee for Design the landing page hero')).toHaveValue(rafi.id);
  await expect(plan.getByLabel('Assignee for Build the enquiry form')).toHaveValue('');
  await expect(plan.getByLabel('Due date for Write the page copy')).toHaveValue('');

  await plan.getByRole('checkbox', { name: 'Include Write the page copy' }).click();
  await plan.getByLabel('Assignee for Build the enquiry form').selectOption({ label: 'Rafi Islam · Frontend Developer' });
  await plan.getByRole('button', { name: 'Create project with 2 tasks' }).click();

  await expect(page.getByRole('heading', { name: 'Spring Admissions Landing' })).toBeVisible();
  await expect(page.getByText('Design the landing page hero')).toBeVisible();
  await expect(page.getByText('Build the enquiry form')).toBeVisible();
  await expect(page.getByText('Write the page copy')).toHaveCount(0);

  const projectId = new URL(page.url()).pathname.split('/').pop();
  const tasks = await (await page.request.get(`/api/tasks?projectId=${projectId}`)).json();
  expect(tasks).toHaveLength(2);
  for (const t of tasks) expect(t.assignees.map((a: any) => a.name)).toEqual(['Rafi Islam']);

  // What was sent to "OpenRouter".
  const sent = await (await page.request.get(`${MOCK}/__requests`)).json();
  const last = sent.at(-1);
  expect(last.headers['x-title']).toBe('SEG Workspace');
  expect(last.body).toMatchObject({ model: 'anthropic/claude-haiku-5.5', response_format: { type: 'json_object' } });
  expect(JSON.stringify(last.body.messages)).toContain('Rafi Islam');
});

test('Ask AI answers from the command palette', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Ask AI' }).click();
  const ask = page.getByRole('dialog', { name: 'Ask AI' });
  await ask.getByLabel('Ask AI').fill('What should I work on next?');
  await ask.getByLabel('Ask AI').press('Enter');
  await expect(ask.getByText('Mock answer from the e2e OpenRouter stand-in.')).toBeVisible();

  // Tab switches between search and AI.
  await ask.getByLabel('Ask AI').press('Tab');
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
  await expect(page.getByRole('option', { name: /Ask AI: What should I work on next\?/ })).toBeVisible();
});
