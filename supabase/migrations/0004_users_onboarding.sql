-- 0004: user management and client onboarding. The app applies the same statements on start (SCHEMA_ADDITIONS in
-- lib/data/pg.ts), so running this by hand is optional.
alter table profiles add column if not exists email text not null default '';
alter table profiles add column if not exists disabled boolean not null default false;
alter table profiles add column if not exists must_change_password boolean not null default false;
alter table profiles add column if not exists created_at timestamptz not null default now();
create unique index if not exists profiles_email_unique on profiles (lower(email)) where email <> '';
alter table tenants add column if not exists onboarding jsonb not null default '{}';

-- Existing profiles: fill in the email from the auth user.
update profiles p set email = u.email from auth.users u where u.id = p.id and p.email = '';
