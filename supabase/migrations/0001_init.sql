-- CallsDash phase 1 schema. Multi-tenant: every row carries tenant_id and row-level security limits
-- clinic users to their own tenant. Admins (role = 'admin') see everything.
-- NOTE: not yet applied to a live Supabase project; run it in a fresh project and report any errors.

create extension if not exists pgcrypto;

create type user_role as enum ('admin', 'manager', 'receptionist');
create type batch_kind as enum ('rollover', 'package', 'topup', 'payg');

create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  status text not null default 'live' check (status in ('live', 'error', 'suspended')),
  branding jsonb not null default '{}',            -- displayName, displayNameAr, primaryColor, logoUrl, domain
  plan jsonb not null default '{}',                -- type, includedCredits, monthlyPriceBhd, pricePerCreditBhd, rolloverCap, periodStart
  permissions jsonb not null default '{"editPrompt":true,"editVoice":true,"editBehaviour":true,"editKnowledge":true}',
  allowed_domains text[] not null default '{}',
  zero_balance_policy text not null default 'pause' check (zero_balance_policy in ('pause', 'overdraft')),
  low_balance_threshold numeric not null default 0.15,
  retention_days int not null default 90,
  calendar_connected boolean not null default false,
  channels jsonb not null default '{"website":"pending","whatsapp":"off","instagram":"off","phone":"off"}',
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  tenant_id uuid references tenants on delete cascade,  -- null for admins
  role user_role not null default 'receptionist',
  full_name text,
  check ((role = 'admin') = (tenant_id is null))
);

-- helper functions used by every policy
create function auth_tenant() returns uuid language sql stable security definer set search_path = public as
  $$ select tenant_id from profiles where id = auth.uid() $$;
create function auth_is_admin() returns boolean language sql stable security definer set search_path = public as
  $$ select coalesce((select role = 'admin' from profiles where id = auth.uid()), false) $$;

create table agents (
  tenant_id uuid primary key references tenants on delete cascade,
  elevenlabs_agent_id text,
  settings jsonb not null,                          -- prompt sections, temperature, replyLength, formality, arabicWrittenStyle, voices
  updated_at timestamptz not null default now()
);

create table agent_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  created_at timestamptz not null default now(),
  author text not null,
  summary text not null,
  settings jsonb not null
);

create table doctors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  name text not null, specialty text, color text not null default '#0e7c86',
  google_calendar_id text
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  doctor_id uuid references doctors on delete set null,
  patient_name text not null, patient_phone text not null, service text,
  starts_at timestamptz not null, duration_min int not null default 30,
  status text not null default 'confirmed' check (status in ('confirmed', 'rescheduled', 'cancelled', 'no_show')),
  conversation_id uuid, calendar_event_id text,
  created_at timestamptz not null default now()
);
create index on bookings (tenant_id, starts_at);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  elevenlabs_conversation_id text unique,           -- webhook retries must not double-charge
  channel text not null check (channel in ('website', 'whatsapp', 'instagram', 'phone')),
  mode text not null check (mode in ('voice', 'text')),
  language text not null check (language in ('en', 'ar')),
  started_at timestamptz not null, duration_sec int not null default 0, messages int not null default 0,
  outcome text not null check (outcome in ('booked', 'answered', 'handed_off', 'abandoned')),
  sentiment text not null default 'neutral',
  summary text not null default '',
  transcript jsonb not null default '[]',
  recording_path text,                              -- private storage object, served by signed URL
  credits_charged numeric(12,2) not null default 0,
  cost_usd numeric(12,4) not null default 0,
  search tsvector generated always as (
    to_tsvector('simple', coalesce(summary, '') || ' ' || coalesce(transcript::text, ''))
  ) stored
);
create index on conversations (tenant_id, started_at desc);
create index conversations_search on conversations using gin (search);

create table knowledge_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  question text not null, answer text not null, language text not null default 'en'
);

create table credit_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  kind batch_kind not null,
  amount numeric(12,2) not null check (amount > 0),
  remaining numeric(12,2) not null check (remaining >= 0),
  purchased_at timestamptz not null default now(),
  expires_at timestamptz not null,
  note text
);
create index on credit_batches (tenant_id, expires_at);

create table credit_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('topup', 'package_renewal', 'rollover', 'usage', 'expiry')),
  credits numeric(12,2) not null,                   -- positive adds, negative deducts
  channel text, conversation_id uuid, note text
);
create index on credit_ledger (tenant_id, at desc);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  at timestamptz not null default now(),
  severity text not null check (severity in ('info', 'warning', 'error')),
  message text not null, resolved boolean not null default false
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants on delete cascade,
  at timestamptz not null default now(),
  actor text not null, action text not null
);

create table top_up_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  at timestamptz not null default now(),
  credits int not null, status text not null default 'open' check (status in ('open', 'done'))
);

/*
 * Spend credits: rollover first, then the package, then top-ups oldest first (same order as lib/credits.ts).
 * Returns the shortfall (credits that could not be covered). Called by the webhook with the service role.
 */
create function deduct_credits(p_tenant uuid, p_amount numeric, p_conversation uuid default null, p_channel text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  b record;
  left_over numeric := round(p_amount, 2);
  take numeric;
begin
  for b in
    select id, remaining from credit_batches
    where tenant_id = p_tenant and remaining > 0 and expires_at > now()
    order by case kind when 'rollover' then 0 when 'package' then 1 else 2 end, purchased_at
    for update
  loop
    exit when left_over <= 0;
    take := least(b.remaining, left_over);
    update credit_batches set remaining = remaining - take where id = b.id;
    left_over := left_over - take;
  end loop;
  insert into credit_ledger (tenant_id, kind, credits, channel, conversation_id)
    values (p_tenant, 'usage', -(round(p_amount, 2) - left_over), p_channel, p_conversation);
  return left_over;
end $$;
revoke all on function deduct_credits from public, anon, authenticated;

-- Row-level security -----------------------------------------------------------------------------
alter table tenants enable row level security;
alter table profiles enable row level security;
alter table agents enable row level security;
alter table agent_versions enable row level security;
alter table doctors enable row level security;
alter table bookings enable row level security;
alter table conversations enable row level security;
alter table knowledge_items enable row level security;
alter table credit_batches enable row level security;
alter table credit_ledger enable row level security;
alter table alerts enable row level security;
alter table audit_log enable row level security;
alter table top_up_requests enable row level security;

create policy tenants_read on tenants for select using (auth_is_admin() or id = auth_tenant());
create policy tenants_admin on tenants for all using (auth_is_admin()) with check (auth_is_admin());
create policy profiles_read on profiles for select using (auth_is_admin() or id = auth.uid() or tenant_id = auth_tenant());
create policy profiles_admin on profiles for all using (auth_is_admin()) with check (auth_is_admin());

-- Read-only for clinic users, full access for admins (wallet and logs are written by the server only)
do $$
declare t text;
begin
  foreach t in array array['credit_batches', 'credit_ledger', 'agent_versions', 'conversations'] loop
    execute format('create policy %I_read on %I for select using (auth_is_admin() or tenant_id = auth_tenant())', t, t);
    execute format('create policy %I_admin on %I for all using (auth_is_admin()) with check (auth_is_admin())', t, t);
  end loop;
  -- alerts and the audit log: clinic users read their own, only admins write
  foreach t in array array['alerts', 'audit_log'] loop
    execute format('create policy %I_read on %I for select using (auth_is_admin() or tenant_id = auth_tenant())', t, t);
    execute format('create policy %I_admin on %I for all using (auth_is_admin()) with check (auth_is_admin())', t, t);
  end loop;
end $$;

-- Clinic users may manage their own bookings, knowledge and top-up requests. Agent settings go through
-- server actions that check tenants.permissions, so clinic users only read them here.
create policy agents_read on agents for select using (auth_is_admin() or tenant_id = auth_tenant());
create policy agents_admin on agents for all using (auth_is_admin()) with check (auth_is_admin());
create policy doctors_rw on doctors for all using (auth_is_admin() or tenant_id = auth_tenant()) with check (auth_is_admin() or tenant_id = auth_tenant());
create policy bookings_rw on bookings for all using (auth_is_admin() or tenant_id = auth_tenant()) with check (auth_is_admin() or tenant_id = auth_tenant());
create policy knowledge_rw on knowledge_items for all using (auth_is_admin() or tenant_id = auth_tenant()) with check (auth_is_admin() or tenant_id = auth_tenant());
create policy topup_requests_rw on top_up_requests for all using (auth_is_admin() or tenant_id = auth_tenant()) with check (auth_is_admin() or tenant_id = auth_tenant());

-- Retention: recordings and transcripts are removed after the tenant's retention window (default 90 days).
-- Schedule with pg_cron once the extension is enabled:
--   select cron.schedule('retention', '15 3 * * *', $$ select purge_expired_conversations() $$);
create function purge_expired_conversations() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update conversations c set transcript = '[]', recording_path = null
  from tenants t
  where c.tenant_id = t.id and c.started_at < now() - make_interval(days => t.retention_days)
    and (c.transcript <> '[]'::jsonb or c.recording_path is not null);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function purge_expired_conversations from public, anon, authenticated;
