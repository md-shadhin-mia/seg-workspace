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
| **Other** | Dashboard (your focus, reviews waiting, team health for leads), My Tasks, ⌘K search and commands, and a mobile layout with a bottom navigation bar. |

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

## Security notes

- **Passwords and tokens:** passwords use argon2id. Session, reset and invite tokens are random and stored only as SHA-256 hashes. Resetting a password signs the account out everywhere.
- **Cookies and CSRF:** session cookies are http-only and `SameSite=Lax` (`Secure` on HTTPS). Every state-changing request must carry a custom header, which blocks cross-site form posts.
- **Access control:** checked on the server for every request. Ids the user can't access return *Not found*, so they don't reveal that the item exists.
- **Rate limits:** sign-in, sign-up and reset are limited per IP and email. This stops password guessing without locking out an office that shares one IP. There is also a general per-IP limit.
- **Login responses:** wrong-email and wrong-password answers are identical, and both take the same time. Duplicate sign-ups get the same answer as new ones.
- **Uploads:** stored under random names outside the web root and served only after an access check. Only safe types (images, PDF, video, plain text) open in the browser; everything else, including SVG and HTML, downloads.
- **Headers:** a strict Content-Security-Policy, `X-Content-Type-Options`, `frame-ancestors 'none'`, and HSTS on HTTPS.

## Development

Requires Node 20+ and either Docker or PostgreSQL 14+.

```bash
npm install
npm run db:up                            # PostgreSQL in Docker on localhost:5432 with seg, seg_test and seg_e2e
npm run dev                              # API on :3000, web on :5173 (proxies /api)
```

`npm run db:down` stops the database and keeps its data. To wipe it, run `docker compose -f docker-compose.dev.yml down -v`. To use your own PostgreSQL instead, run `createdb seg && createdb seg_test && createdb seg_e2e`, or point `DATABASE_URL` / `TEST_DATABASE_URL` / `E2E_DATABASE_URL` elsewhere.

Tests:

```bash
npm run typecheck
npm test          # API integration tests against a real database + front-end unit tests
npm run build
npm run e2e       # browser tests: sign-up → approval → assignment → submit → review → isolation
```

The e2e suite resets the database named in `E2E_DATABASE_URL` (default `seg_e2e`) and refuses to run against a database whose name doesn't contain "e2e" or "test".

### Project layout

```
server/src/
  app.ts               Fastify setup: security headers, CSRF, sessions, errors, static files
  lib/access.ts        Who can see and change what; overall status from assignee statuses
  routes/              auth, users, teams, projects, tasks (+assignees, checklist, comments, submissions), files, notifications
  migrations/          SQL migrations, applied automatically on start
web/src/
  pages/               Auth, Dashboard, MyTasks, Project, Team, Task, Inbox, Settings, admin/Users, admin/Teams
  components/          Shell (sidebar, top bar), command palette, modals, pickers, task rows
e2e/                   Playwright end-to-end tests
```
