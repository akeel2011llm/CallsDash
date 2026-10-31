-- Business type per client (clinic, salon, retail, restaurant, service, custom) and its words.
-- Optional and non-destructive: the app adds this column by itself on start (lib/data/pg.ts); a missing value means "clinic".
alter table tenants add column if not exists business jsonb;
