-- Any business, step 2b: answers to each client's own fields (defined in tenants.business.fields) on bookings, customers and
-- team members, by field key. Empty = no answers. Applied automatically on start too.
alter table bookings add column if not exists extra jsonb;
alter table customers add column if not exists extra jsonb;
alter table doctors add column if not exists extra jsonb;
