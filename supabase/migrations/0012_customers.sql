-- The people the assistant has talked to, found again by the last 8 digits of their phone number. The assistant looks them
-- up by phone and saves their details; the clinic's staff manage them on the Customers screen. The app applies this itself
-- on start (lib/data/pg.ts); this file is for fresh databases and review.
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  phone text not null,
  phone_key text not null,
  name text not null default '',
  cpr text,
  language text,
  email text,
  notes text not null default '',
  conversation_ids text[] not null default '{}',
  history jsonb not null default '[]',
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists customers_phone on customers (tenant_id, phone_key);
create index if not exists customers_conversations on customers using gin (conversation_ids);
alter table customers enable row level security;
