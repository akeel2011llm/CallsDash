-- What the assistant tells customers about a doctor, in English and Arabic.
-- The app applies this itself on start (lib/data/pg.ts); this file is for fresh databases and review.
alter table doctors add column if not exists about text;
alter table doctors add column if not exists about_ar text;
