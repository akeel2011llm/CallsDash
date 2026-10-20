-- Several packages per client, and a catalogue of packages to assign from.
-- The app runs these same statements by itself on start, so running this file by hand is optional.
alter table credit_batches add column if not exists plan_id text;

create table if not exists packages (
  id uuid primary key default gen_random_uuid(),
  name text not null, name_ar text, description text,
  type text not null check (type in ('package', 'payg')),
  included_credits integer not null default 0,
  monthly_price_bhd numeric(10,3) not null,
  price_per_credit_bhd numeric(10,4) not null,
  rollover_cap numeric(4,3) not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
alter table packages enable row level security;  -- no policies: only the server (service connection) reads and writes it

-- tenants.plan now holds a list of plans; a single old-style plan object is read as a list of one.
