-- Doctors' photos for the Data screen. A photo is a small data: URL kept apart from the doctors table so doctor lists stay light.
-- The app applies this itself on start (lib/data/pg.ts); this file is for fresh databases and review.
create table if not exists doctor_photos (
  doctor_id uuid primary key references doctors on delete cascade,
  tenant_id uuid not null references tenants on delete cascade,
  image text not null,
  updated_at timestamptz not null default now()
);
alter table doctor_photos enable row level security;
