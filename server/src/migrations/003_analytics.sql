-- Performance analytics. KPIs are computed from task_assignees (an assignee's status and when it
-- last changed), task due dates and submission reviews; nothing is stored per score.

-- Optional grouping of teams into departments, for org-wide reporting.
alter table teams add column department text not null default '';

-- One row: the weights and targets admins choose for KPI scores.
create table kpi_settings (
  id         integer primary key default 1 check (id = 1),
  settings   jsonb not null,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- An assignee becomes Done by a status change or an approval; both stamp updated_at.
create index task_assignees_done_idx on task_assignees (updated_at) where status = 'done';
create index submissions_reviewed_idx on submissions (reviewed_at) where reviewed_at is not null;
create index activity_created_idx on activity (created_at desc);
