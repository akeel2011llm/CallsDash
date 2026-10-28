-- The catalogue: what a clinic offers (a product, treatment or package) with details and a photo. The assistant looks items up
-- with the find_item tool and shows the photo in website chat. The photo is a small data: URL kept apart from the list queries.
-- Also an index so a customer can be found by CPR number, for clinics that choose that over the phone number.
-- The app applies this itself on start (lib/data/pg.ts); this file is for fresh databases and review.
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  name text not null,
  name_ar text,
  details text not null default '',
  details_ar text,
  price text,
  keywords text not null default '',
  active boolean not null default true,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists items_tenant on items (tenant_id, name);
alter table items enable row level security;
create index if not exists customers_cpr on customers (tenant_id, cpr) where cpr is not null;
