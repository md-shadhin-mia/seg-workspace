-- SEG Workspace schema. Access rules are enforced in the API on every query
-- (team membership, task assignment); the schema keeps that data authoritative.

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  name          text not null,
  title         text not null default '',
  password_hash text,
  role          text not null default 'member' check (role in ('admin', 'member')),
  status        text not null default 'pending' check (status in ('pending', 'active', 'rejected', 'disabled')),
  created_at    timestamptz not null default now(),
  approved_at   timestamptz,
  approved_by   uuid references users(id) on delete set null,
  last_login_at timestamptz
);
create unique index users_email_key on users (lower(email));
create index users_status_idx on users (status);

create table sessions (
  id           text primary key,               -- sha256 of the cookie token, never the token itself
  user_id      uuid not null references users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  user_agent   text,
  ip           text
);
create index sessions_user_idx on sessions (user_id);

create table auth_tokens (
  id         text primary key,                 -- sha256 of the emailed token
  user_id    uuid not null references users(id) on delete cascade,
  kind       text not null check (kind in ('reset', 'invite')),
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index auth_tokens_user_idx on auth_tokens (user_id);

create table teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  created_at  timestamptz not null default now()
);
create unique index teams_name_key on teams (lower(name));

create table team_members (
  team_id  uuid not null references teams(id) on delete cascade,
  user_id  uuid not null references users(id) on delete cascade,
  role     text not null default 'member' check (role in ('lead', 'member')),
  added_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user_idx on team_members (user_id);

create table projects (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  name        text not null,
  description text not null default '',
  status      text not null default 'on_track' check (status in ('on_track', 'at_risk', 'off_track', 'completed')),
  due_date    date,
  lead_id     uuid references users(id) on delete set null,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
create index projects_team_idx on projects (team_id);

create table tasks (
  id           uuid primary key default gen_random_uuid(),
  seq          bigserial unique,
  project_id   uuid not null references projects(id) on delete cascade,
  title        text not null,
  description  text not null default '',
  priority     text not null default 'medium' check (priority in ('urgent', 'high', 'medium', 'low')),
  status       text not null default 'todo' check (status in ('todo', 'in_progress', 'review', 'changes', 'done')),
  due_date     date,
  reviewer_id  uuid references users(id) on delete set null,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index tasks_project_idx on tasks (project_id);
create index tasks_due_idx on tasks (due_date);

create table task_assignees (
  task_id     uuid not null references tasks(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  status      text not null default 'todo' check (status in ('todo', 'in_progress', 'review', 'changes', 'done')),
  assigned_by uuid references users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index task_assignees_user_idx on task_assignees (user_id);

create table checklist_items (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  text       text not null,
  done       boolean not null default false,
  position   integer not null default 0,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index checklist_task_idx on checklist_items (task_id);

create table comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  author_id  uuid references users(id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);
create index comments_task_idx on comments (task_id, created_at);

create table files (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  uploader_id uuid references users(id) on delete set null,
  name        text not null,
  mime        text not null,
  size        bigint not null,
  storage_key text not null unique,
  purpose     text not null check (purpose in ('resource', 'submission')),
  created_at  timestamptz not null default now()
);
create index files_task_idx on files (task_id);

create table links (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  added_by   uuid references users(id) on delete set null,
  title      text not null,
  url        text not null,
  created_at timestamptz not null default now()
);
create index links_task_idx on links (task_id);

create table submissions (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  version     integer not null,
  note        text not null default '',
  state       text not null default 'pending' check (state in ('pending', 'approved', 'changes')),
  feedback    text,
  reviewed_by uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (task_id, user_id, version)
);
create index submissions_task_idx on submissions (task_id);

create table submission_items (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  kind          text not null check (kind in ('link', 'file')),
  title         text not null,
  url           text,
  file_id       uuid references files(id) on delete set null
);
create index submission_items_sub_idx on submission_items (submission_id);

create table activity (
  id         bigserial primary key,
  task_id    uuid not null references tasks(id) on delete cascade,
  actor_id   uuid references users(id) on delete set null,
  action     text not null,
  meta       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_task_idx on activity (task_id, created_at);

create table notifications (
  id         bigserial primary key,
  user_id    uuid not null references users(id) on delete cascade,
  type       text not null,
  task_id    uuid references tasks(id) on delete cascade,
  actor_id   uuid references users(id) on delete set null,
  body       text not null default '',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);

insert into teams (name, description) values
  ('Development', 'Websites, the student application portal and internal tools.'),
  ('Digital Marketing', 'Campaigns, content, creative and paid acquisition.');
