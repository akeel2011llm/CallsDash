-- Full management: doctors can be paused, work their own hours and take leave; the clinic can close on holidays;
-- the admin can correct a balance by hand. The app applies this itself on start (lib/data/pg.ts); this file is for
-- fresh databases and review.
alter table doctors add column if not exists active boolean not null default true;
alter table doctors add column if not exists hours jsonb;                         -- null = the clinic's opening hours
alter table doctors add column if not exists time_off jsonb not null default '[]'; -- [{from, to, note}] whole local days
alter table tenants add column if not exists closures jsonb not null default '[]'; -- public holidays, same shape

alter table credit_ledger drop constraint if exists credit_ledger_kind_check;
alter table credit_ledger drop constraint if exists credit_ledger_kind_v2;
alter table credit_ledger add constraint credit_ledger_kind_v2
  check (kind in ('topup', 'package_renewal', 'rollover', 'usage', 'expiry', 'adjustment'));
