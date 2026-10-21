-- A log of every booking-tool call the ElevenLabs agent makes, shown on the admin Test agent page so a failed
-- booking shows its reason. Rows older than 30 days are pruned by the app. The app applies this itself on start
-- (lib/data/pg.ts); this file is for fresh databases and review.
create table if not exists agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants on delete cascade, -- null: the call named an agent no client owns
  at timestamptz not null default now(),
  tool text not null,
  ok boolean not null,
  code text,
  detail text not null default '',
  ms integer not null default 0
);
create index if not exists agent_tool_calls_at on agent_tool_calls (tenant_id, at desc);
alter table agent_tool_calls enable row level security;
