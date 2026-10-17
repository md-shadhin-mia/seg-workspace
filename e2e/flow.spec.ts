import { expect, test, type Browser, type Page } from '@playwright/test';

const ADMIN = { email: 'admin@e2e.test', password: 'admin-password-123' };
const WALID = { name: 'Walid Hasan', email: 'walid@e2e.test', password: 'walid-password-123' };
const TANVIR = { email: 'tanvir@e2e.test', password: 'tanvir-password-123' };

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
async function userPage(browser: Browser, who: { email: string; password: string }) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, who.email, who.password);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Good');
  return page;
}

test.describe.configure({ mode: 'serial' });
let taskUrl = '';

test('a new person requests an account and cannot sign in until approved', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Full name').fill(WALID.name);
  await page.getByLabel('Work email').fill(WALID.email);
  await page.getByLabel('Job title').fill('Graphic Designer');
  await page.getByLabel('Password', { exact: true }).fill(WALID.password);
  await page.getByRole('button', { name: 'Request account' }).click();
  await expect(page.getByText('Request sent.')).toBeVisible();

  await signIn(page, WALID.email, WALID.password);
  await expect(page.getByRole('alert')).toContainText('waiting for an admin');
});

test('an admin approves the sign-up into Digital Marketing and sets up work', async ({ browser }) => {
  const page = await userPage(browser, ADMIN);
  await page.getByRole('link', { name: 'Users' }).click();
  await page.getByRole('button', { name: /Waiting for approval/ }).click();
  const row = page.getByRole('row', { name: /Walid Hasan/ });
  await row.getByRole('button', { name: 'Approve' }).click();
  const dialog = page.getByRole('dialog', { name: 'Approve Walid Hasan' });
  await dialog.getByRole('checkbox', { name: 'Digital Marketing' }).check();
  await dialog.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Walid Hasan is approved and can sign in')).toBeVisible();

  // Two more people through the API: a second marketing assignee and a developer.
  const teams = await (await page.request.get('/api/teams')).json();
  const mkt = teams.find((t: any) => t.name === 'Digital Marketing').id;
  const dev = teams.find((t: any) => t.name === 'Development').id;
  const headers = { 'x-requested-with': 'seg-web' };
  await page.request.post('/api/users', { headers, data: { name: 'Sabbir Hossain', email: 'sabbir@e2e.test', teams: [{ teamId: mkt, role: 'member' }] } });
  const tanvir = await (await page.request.post('/api/users', { headers, data: { name: 'Tanvir Ahmed', email: TANVIR.email, teams: [{ teamId: dev, role: 'member' }] } })).json();
  const token = new URL(tanvir.inviteUrl).searchParams.get('token');
  const invite = await browser.newPage();
  await invite.goto(`/accept-invite?token=${token}`);
  await expect(invite.getByText('tanvir@e2e.test')).toBeVisible();
  await invite.getByLabel('New password').fill(TANVIR.password);
  await invite.getByLabel('Repeat password').fill(TANVIR.password);
  await invite.getByRole('button', { name: /Create password/ }).click();
  await expect(invite.getByRole('heading', { level: 1 })).toContainText('Tanvir');

  // Project and a task with two assignees.
  await page.getByRole('link', { name: 'Digital Marketing' }).first().click();
  await page.locator('#content').getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Malaysia Study Fair');
  await expect(page.getByLabel('Team').locator('option:checked')).toHaveText('Digital Marketing');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Malaysia Study Fair' })).toBeVisible();

  await page.getByRole('button', { name: 'Add task' }).click();
  const nt = page.getByRole('dialog', { name: 'New task' });
  await nt.getByLabel('Task title').fill('Malaysia Campaign Banner');
  await nt.getByRole('button', { name: 'Choose assignees' }).click();
  await page.getByRole('menuitemcheckbox', { name: /Farhana Chowdhury/ }).click();
  await page.getByRole('menuitemcheckbox', { name: /Walid Hasan/ }).click();
  await page.getByRole('menuitemcheckbox', { name: /Sabbir Hossain/ }).click();
  await page.keyboard.press('Escape');
  await expect(nt.getByRole('button', { name: 'Choose assignees' })).toContainText('2 people');
  await nt.getByRole('button', { name: 'Create task' }).click();
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Malaysia Campaign Banner', level: 2 })).toBeVisible();
  taskUrl = new URL(page.url()).pathname;
});

test('an assignee updates their own status and submits work', async ({ browser }) => {
  const page = await userPage(browser, WALID);
  await page.getByRole('link', { name: 'My Tasks' }).first().click();
  await page.getByRole('link', { name: /Malaysia Campaign Banner/ }).click();

  // Only Walid's own status is clickable.
  await expect(page.getByRole('button', { name: 'Status: To Do. Change' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Status: To Do. Change' }).click();
  await page.getByRole('menuitem', { name: 'In Progress' }).click();
  await expect(page.getByRole('button', { name: 'Status: In Progress. Change' })).toBeVisible();

  await page.getByRole('tab', { name: /Submissions/ }).click();
  await page.getByLabel('Submission link').fill('https://www.figma.com/file/malaysia-banner');
  await page.getByRole('button', { name: 'Add link' }).click();
  await page.getByLabel('Note for the reviewer').fill('Web hero and Facebook cover.');
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText(/Version 1 submitted/)).toBeVisible();
  await expect(page.getByText('Your version 1 is waiting for review.')).toBeVisible();
});

test('the reviewer asks for changes, the assignee resubmits, and approval completes their part', async ({ browser }) => {
  const admin = await userPage(browser, ADMIN);
  await admin.goto(`${taskUrl}?tab=submissions`);
  await admin.getByRole('button', { name: 'Request changes' }).click();
  await admin.getByLabel('Feedback').fill('Logos are crowded. Move them to a bottom row.');
  await admin.getByRole('button', { name: 'Send feedback' }).click();
  await expect(admin.getByText('Feedback sent')).toBeVisible();

  const walid = await userPage(browser, WALID);
  await walid.goto(`${taskUrl}?tab=submissions`);
  await expect(walid.getByText('Logos are crowded.').first()).toBeVisible();
  await walid.getByLabel('Submission link').fill('https://www.figma.com/file/malaysia-banner-v2');
  await walid.getByRole('button', { name: 'Add link' }).click();
  await walid.getByRole('button', { name: 'Submit for review' }).click();
  await expect(walid.getByText(/Version 2 submitted/)).toBeVisible();

  await admin.reload();
  await admin.getByRole('button', { name: 'Approve' }).click();
  await expect(admin.getByText('Approved', { exact: true }).first()).toBeVisible();
  await admin.getByRole('tab', { name: 'Overview' }).click();
  await expect(admin.getByRole('button', { name: /People done/ })).toContainText('1/2');

  await walid.goto('/inbox');
  await expect(walid.getByText(/approved version 2/)).toBeVisible();
});

test('people outside the team cannot open the task', async ({ browser }) => {
  const page = await userPage(browser, TANVIR);
  await expect(page.getByRole('link', { name: 'Digital Marketing' })).toHaveCount(0);
  await page.goto(taskUrl);
  await expect(page.getByText("This task isn't available")).toBeVisible();
});
