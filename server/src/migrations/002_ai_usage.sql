-- One row per AI request, including failed ones. Used for the per-person hourly limit
-- and the admin usage card. Prompts and replies are not stored.
create table ai_usage (
  id                bigserial primary key,
  user_id           uuid references users(id) on delete set null,
  feature           text not null,
  model             text not null,
  prompt_tokens     integer not null default 0,
  completion_tokens integer not null default 0,
  ok                boolean not null,
  created_at        timestamptz not null default now()
);
create index ai_usage_user_idx on ai_usage (user_id, created_at desc);
create index ai_usage_created_idx on ai_usage (created_at);
