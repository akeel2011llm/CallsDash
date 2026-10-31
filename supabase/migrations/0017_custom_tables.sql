-- Custom tables (milestone 6c of docs/reorganization.md): tables the admin designs for a client, and their rows.
-- The app applies this itself on start (lib/data/pg.ts); this file is for fresh databases and review. Nothing existing changes.
create table if not exists data_tables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  name text not null,
  name_ar text,
  fields jsonb not null default '[]',
  client_edit boolean not null default true,
  assistant boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists data_tables_tenant on data_tables (tenant_id);
alter table data_tables enable row level security;

create table if not exists data_rows (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references data_tables on delete cascade,
  tenant_id uuid not null references tenants on delete cascade,
  cells jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create index if not exists data_rows_table on data_rows (tenant_id, table_id);
alter table data_rows enable row level security;
