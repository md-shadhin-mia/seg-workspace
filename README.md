# SEG Workspace

Task and review workspace for SEG Digital. People request an account, an admin approves them into a team, and work is assigned to one or more people. Each assignee keeps their own status and submits their own versions for review.

- **Back end:** Node 22, Fastify, PostgreSQL 16
- **Front end:** React 18, Vite, TanStack Query
- **Deploy:** Docker Compose with Caddy (automatic HTTPS) and nightly database backups

## What's in it

| Area | What it does |
| --- | --- |
| **Sign-up & sign-in** | Open sign-up creates a *pending* account. Admins are notified in the app and by email, then approve (choosing teams and role) or decline. Sessions use secure http-only cookies, stored hashed in the database, lasting 30 days and renewed with use. |
| **Passwords** | Hashed with argon2id. Includes forgot-password and reset-by-email (link works once and expires in 1 hour), change password (signs out your other devices), and a list of signed-in devices with a "sign out others" button. |
| **Admin** | Approve or decline sign-ups. Create people directly; they get an invite link, which the admin can also copy if email isn't set up. Set role and teams, send a password link, and turn accounts off (signs them out everywhere). Create, rename and delete teams. |
| **Teams & access** | Teams are separate workspaces. Everyone sees their own teams' projects and tasks, plus any task they are assigned to, and nothing else. Admins see everything. This is checked by the server on every request. |
| **Tasks** | Several assignees per task, each with their **own status**. The task's overall status is worked out from everyone's status. Tasks also have a reviewer, priority, due date, checklist, files and links, comments with @mentions, and an activity history. |
| **Submissions & review** | Each assignee submits links and/or files as versions (V1, V2…). The reviewer approves the version (that person becomes *Done*) or requests changes with written feedback (that person becomes *Changes Requested*). Earlier versions are kept. |
| **Notifications** | In-app inbox, plus email for being assigned, review requests, changes requested, approvals and mentions. |
| **AI (optional)** | Through OpenRouter. On a task: rewrite the description as *Goal / What's needed / Done when*, summarize where it stands, suggest checklist steps, and summarize reviewer feedback across versions. Leads can draft a whole project plan (tasks, assignees, dates) and review it before anything is created. *Ask AI* in ⌘K answers questions about your work using only what you can already see. Off and hidden unless a key is set. |
| **Dashboard** | Role-aware: admins see the whole organisation, team leads the teams they lead, everyone can switch to *My work*. KPI cards with change against the previous period, productivity trend, KPI score with its breakdown, people ranking, workload by status, team comparison, project progress, a due-date calendar, reviews waiting and a live activity feed. Date range (7/30/90 days, quarter, year or custom) is kept in the URL. |
| **Performance analytics** | *Analytics* (leads and admins) filters by department, team, project, person and status, with a sortable people table. *My performance* and each person's page show their KPIs, goals, project contributions and recently completed work. Each project has an *Insights* tab: progress over time, status mix, member contributions, delayed work and a due-date timeline. See *How KPIs are measured* below. |
| **Other** | My Tasks, ⌘K search and commands, an animated product preview on the sign-in page, and a mobile layout with a bottom navigation bar. |

### Who can do what

| | Admin | Team lead | Team member | Assignee from another team |
| --- | --- | --- | --- | --- |
| See the team's projects and tasks | All teams | Their team | Their team | Only the assigned task |
| Create projects | ✓ | In their team | – | – |
| Create tasks | ✓ | ✓ | ✓ | – |
| Edit task details, checklist, files | ✓ | ✓ | If assigned or creator | ✓ (that task) |
| Change who is assigned / the reviewer, delete | ✓ | ✓ | If creator | – |
| Change a person's status | Anyone's | Anyone's | Only their own | Only their own |
| Submit work | If assigned | If assigned | If assigned | ✓ |
| Approve / request changes | ✓ | ✓ | If set as reviewer | If set as reviewer |

### How KPIs are measured

Everything is computed from data the app already records; nothing is typed in or estimated. Each person on a task counts as one assignment.

| KPI | Definition |
| --- | --- |
| Completion rate | Assignments finished in the period ÷ assignments on someone's plate during it (assigned by the end, not finished before the start) |
| On-time delivery | Of assignments finished in the period with a due date, the share finished on or before it |
| Approved on review | Of submissions reviewed in the period, the share approved rather than sent back |
| Overdue | Open assignments past their due date at the end of the period |
| KPI score | Weighted average of the four above (overdue counts as "share of open work not overdue"). Parts with no data are left out; no score until someone has a minimum number of tasks |

Admins set the weights, targets and minimum under *Analytics → Scoring rules*; everyone can open that dialog to see how scores are made. Every number is shown next to the same figure for the period just before. Teams can be grouped into departments under *Admin → Teams & access*.

Not measured: time spent, leave and availability (workload shows open tasks, not hours), and milestones (the project timeline uses task due dates).

| Who sees what | Admin | Team lead | Member |
| --- | --- | --- | --- |
| Own performance | ✓ | ✓ | ✓ |
| A person's performance | Everyone | People in teams they lead, counting only work in those teams | – |
| Analytics page, team comparison | All teams and departments | Teams they lead | – |
| Project insights | All projects | Their teams' projects | Their teams' projects |

## Deploy on a VPS (about 15 minutes)

You need a Linux server (Ubuntu 22.04/24.04, 1 vCPU and 2 GB RAM is plenty to start) and a domain name.

**1. Point your domain at the server.** Create a DNS **A record**, e.g. `work.segdigital.com` → your server's IP. Wait until it resolves.

**2. Install Docker on the server.**

```bash
curl -fsSL https://get.docker.com | sh
```

**3. Put the project on the server** (git clone, or upload the zip and unzip it), then go into the folder:

```bash
cd seg-workspace
cp .env.example .env
nano .env
```

Fill in at least `APP_URL`, `DOMAIN`, `POSTGRES_PASSWORD`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and the `SMTP_*` lines (see *Email* below).

**4. Start it.**

```bash
docker compose up -d --build
```

The first build takes a few minutes. Caddy then gets an HTTPS certificate automatically, as long as ports 80 and 443 are open.

**5. Sign in** at your domain with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, then change the password under *Profile & security*.

**6. Set up your teams.** *Development* and *Digital Marketing* already exist; add more in *Admin → Teams & access*. Share the sign-up link (`https://your-domain/register`) with staff and approve them from *Admin → Users*, or add people yourself with *Add person*.

### Email

Any SMTP provider works.

**Gmail / Google Workspace:**
1. Turn on 2-Step Verification for the account.
2. Create an **App Password** (Google Account → Security → App passwords).
3. Set:
   - `SMTP_HOST=smtp.gmail.com`
   - `SMTP_PORT=587`
   - `SMTP_SECURE=false`
   - `SMTP_USER=` your address
   - `SMTP_PASS=` the app password
   - `MAIL_FROM=SEG Workspace <your address>`

**Without SMTP:** the app still works. Admins can copy invite and reset links from the Users page, and nothing is emailed.

### AI (optional)

AI features use [OpenRouter](https://openrouter.ai), which gives one API key for models from many providers. Without a key the app works as before and every AI button is hidden.

1. Create an account at openrouter.ai, add credits under **Credits**, then create a key under **Keys** (`sk-or-v1-…`). Giving the key a credit limit caps what it can spend.
2. In `.env` set `OPENROUTER_API_KEY=` to the key, and optionally `AI_MODEL` (see below).
3. `docker compose up -d` (or `docker compose restart app`). Admins can see requests and tokens under *Settings → AI usage this month*.

**Choosing a model.** `AI_MODEL` takes any model id from [openrouter.ai/models](https://openrouter.ai/models). The default, `anthropic/claude-haiku-5.5`, is fast and inexpensive, which suits these short, frequent tasks. A larger model writes somewhat better project plans but costs more per request. The model must support JSON output (`response_format`) for checklists and plans.

**Cost.** OpenRouter bills per token at the price shown on each model's page. Rough sizes per request:

| Feature | Sent (input) | Returned (output) |
| --- | --- | --- |
| Improve, summarize, checklist, feedback | 500–3,000 tokens, depending on the task's comments and history | up to `AI_MAX_TOKENS` (1,500), usually far less |
| Project plan | ~1,000 tokens | up to 3,000 tokens |
| Ask AI | up to ~7,000 tokens (context is capped at about 24,000 characters) | usually under 500 |

Multiply by your model's price per million tokens to estimate spend. Each person is limited to `AI_REQUESTS_PER_HOUR` (60) requests an hour, and every request, including failed ones, is logged (who, which feature, the model and token counts; prompts and answers are not stored).

**Privacy.** When someone uses AI, the relevant workspace content is sent to OpenRouter and to the company that runs the model: task titles, descriptions, checklists, comments, submission notes and reviewer feedback, people's names and job titles, and for *Ask AI* a summary of the tasks, reviews and projects that person can see. Nothing is sent until someone clicks an AI button. Check OpenRouter's and the model provider's data policies before turning AI on; OpenRouter's privacy settings let you restrict which providers your requests may go to.

### Server that already runs nginx

If ports 80/443 are taken by an existing nginx, skip the bundled Caddy and publish the app on localhost only (port `APP_PORT` in `.env`, default 3210):

```bash
docker compose -f docker-compose.yml -f deploy/compose.behind-proxy.yml up -d --build db app backup
```

Then copy `deploy/nginx.conf.example` to `/etc/nginx/conf.d/<your-domain>.conf`, set the domain, run `nginx -t && systemctl reload nginx`, and add HTTPS with `certbot --nginx -d <your-domain>`. Use the same `-f` flags with every later `docker compose` command.

### Updating

```bash
git pull                      # or upload the new version
docker compose up -d --build  # database migrations run automatically on start
```

### Backups and restore

The `backup` service writes a compressed database dump to `./backups` once a day and keeps 14 days. Copy that folder off the server regularly (for example with `rclone` to Google Drive). Uploaded files live in the `uploads` Docker volume.

To restore a database dump:

```bash
docker compose stop app
docker compose exec -T db pg_restore -U seg -d seg --clean --if-exists < backups/seg-YYYYMMDD-HHMM.dump
docker compose start app
```

To back up uploaded files:

```bash
docker run --rm -v seg-workspace_uploads:/data -v "$PWD":/out alpine tar czf /out/uploads.tgz -C /data .
```

### Useful commands

```bash
docker compose ps               # what's running
docker compose logs -f app      # application logs
docker compose restart app      # restart after changing .env
```

## Configuration

All settings come from `.env` (see `.env.example`).

| Variable | Default | Notes |
| --- | --- | --- |
| `APP_URL` | – | Public URL. Used in emails and for secure cookies (`https://` turns on Secure cookies and HSTS). |
| `DATABASE_URL` | set by compose | PostgreSQL connection string. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | – | Creates or restores this admin on start. If not set, the first person to sign up becomes admin. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | – | Outgoing email. |
| `ALLOWED_EMAIL_DOMAIN` | – | Restrict self sign-up to one domain, e.g. `segdigital.com`. |
| `APP_TIMEZONE` | `Asia/Dhaka` | Decides when something is "due today" or "overdue". |
| `MAX_UPLOAD_MB` | `25` | Per file. |
| `SESSION_DAYS` | `30` | How long a sign-in lasts without use. |
| `RATE_LIMIT_AUTH` | `10` | Sign-in and reset attempts per minute, per IP and email. |
| `OPENROUTER_API_KEY` | – | Turns AI on. Empty = AI off and hidden. |
| `AI_MODEL` | `anthropic/claude-haiku-5.5` | Any OpenRouter model id. |
| `AI_REQUESTS_PER_HOUR` | `60` | AI requests per person per hour. |
| `AI_MAX_TOKENS` | `1500` | Longest AI answer, in tokens (project plans may use up to 3,000). |
| `AI_TIMEOUT_SECONDS` | `60` | Give up on an AI request after this long. |
| `AI_BASE_URL` | `https://openrouter.ai/api/v1` | Only change this to use a different OpenAI-compatible gateway. |

## Security notes

- **Passwords and tokens:** passwords use argon2id. Session, reset and invite tokens are random and stored only as SHA-256 hashes. Resetting a password signs the account out everywhere.
- **Cookies and CSRF:** session cookies are http-only and `SameSite=Lax` (`Secure` on HTTPS). Every state-changing request must carry a custom header, which blocks cross-site form posts.
- **Access control:** checked on the server for every request. Ids the user can't access return *Not found*, so they don't reveal that the item exists.
- **Rate limits:** sign-in, sign-up and reset are limited per IP and email. This stops password guessing without locking out an office that shares one IP. There is also a general per-IP limit.
- **Login responses:** wrong-email and wrong-password answers are identical, and both take the same time. Duplicate sign-ups get the same answer as new ones.
- **Uploads:** stored under random names outside the web root and served only after an access check. Only safe types (images, PDF, video, plain text) open in the browser; everything else, including SVG and HTML, downloads.
- **AI:** the server builds every prompt from data the person can already see (the same access checks as the rest of the API), so *Ask AI* can't reveal another team's work. Workspace content goes inside `<data>` tags and the model is told never to follow instructions found there. Answers are shown as plain text, never as HTML, and task links in answers are only created for tasks the server included. Plans are checked before use: assignees must be members of the team, past dates are dropped, and nothing is created until a lead confirms.
- **Headers:** a strict Content-Security-Policy, `X-Content-Type-Options`, `frame-ancestors 'none'`, and HSTS on HTTPS.

## Development

Requires Node 20+ and either Docker or PostgreSQL 14+.

```bash
npm install
npm run db:up                            # PostgreSQL in Docker on localhost:5432 with seg, seg_test and seg_e2e
npm run dev                              # API on :3000, web on :5173 (proxies /api)
```

`npm run dev` loads `.env` and then `server/.env` (values there win). Put local-only settings such as `OPENROUTER_API_KEY` in `server/.env`; both files are gitignored.

`npm run db:down` stops the database and keeps its data. To wipe it, run `docker compose -f docker-compose.dev.yml down -v`. To use your own PostgreSQL instead, run `createdb seg && createdb seg_test && createdb seg_e2e`, or point `DATABASE_URL` / `TEST_DATABASE_URL` / `E2E_DATABASE_URL` elsewhere.

To see the dashboards with realistic numbers, fill a separate demo database (four teams, fifteen people, four months of history). It refuses to touch a database whose name doesn't contain "demo":

```bash
docker compose -f docker-compose.dev.yml exec db createdb -U seg seg_demo
DATABASE_URL=postgres://seg:seg@localhost:5432/seg_demo npm run seed:demo -w server
```

Then run the API against it on another port and point Vite at it with `API_URL`, e.g. `PORT=3001 DATABASE_URL=…/seg_demo` for the server and `API_URL=http://localhost:3001 npx vite --port 5174` in `web/`. Sign in as `admin@demo.test`, or any person's first name `@demo.test`; the password is in `server/scripts/seed-demo.ts`.

Tests:

```bash
npm run typecheck
npm test          # API integration tests against a real database + front-end unit tests
npm run build
npm run e2e       # browser tests: sign-up → approval → assignment → submit → review → isolation, plus the AI project plan
```

The API tests use a fake AI client, and the e2e tests start `e2e/mock-openrouter.mjs` in place of OpenRouter, so no key is needed and no real model is called. If Playwright's own Chromium isn't installed (`npx playwright install chromium`), point `PW_CHROMIUM_PATH` at another Chromium or Chrome binary.

The e2e suite resets the database named in `E2E_DATABASE_URL` (default `seg_e2e`) and refuses to run against a database whose name doesn't contain "e2e" or "test".

### Project layout

```
server/src/
  app.ts               Fastify setup: security headers, CSRF, sessions, errors, static files
  lib/access.ts        Who can see and change what; overall status from assignee statuses
  lib/ai.ts            OpenRouter client (timeouts, error messages), JSON parsing, <data> wrapping
  lib/kpi.ts           KPI definitions: completion, on-time, approval, overdue, weighted score, trend buckets
  routes/              auth, users, teams, projects, tasks (+assignees, checklist, comments, submissions), files, notifications, ai, analytics
  migrations/          SQL migrations, applied automatically on start
web/src/
  pages/               Auth, Dashboard, Analytics, Person, MyTasks, Project, Team, Task, Inbox, Settings, admin/Users, admin/Teams
  components/          Shell (sidebar, top bar), command palette (+ Ask AI), modals, pickers, task rows, AI panels
                       charts.tsx (SVG charts), kpi.tsx (KPI cards, widgets, range picker), insights.tsx (analytics widgets),
                       ProjectInsights.tsx, Showcase.tsx (sign-in preview)
  styles/              app.css (design tokens and base components), insights.css (dashboards, charts, sign-in)
e2e/                   Playwright end-to-end tests and a mock OpenRouter server
```
