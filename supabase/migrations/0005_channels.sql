-- 0005: ElevenLabs agent sync and chat channels. The app applies the same statements on start (SCHEMA_ADDITIONS in lib/data/pg.ts).
alter table tenants add column if not exists integrations jsonb not null default '{}';
create table if not exists tenant_secrets (
  tenant_id uuid primary key references tenants on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now());
alter table tenant_secrets enable row level security;  -- no policy: only the server's own connection can read it
create table if not exists app_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
alter table app_settings enable row level security;
create table if not exists chat_sessions (
  tenant_id uuid not null references tenants on delete cascade,
  channel text not null,
  external_id text not null,
  conversation_id text not null,
  last_at timestamptz not null default now(),
  primary key (tenant_id, channel, external_id));
create index if not exists chat_sessions_conversation on chat_sessions (conversation_id);
alter table chat_sessions enable row level security;
