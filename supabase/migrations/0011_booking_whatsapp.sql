-- The WhatsApp confirmation of a booking: the language the patient speaks (which template is used) and what happened when
-- it was sent (sent, failed, or why it was not), so the clinic team can see it and send it again.
-- The app applies this itself on start (lib/data/pg.ts); this file is for fresh databases and review.
alter table bookings add column if not exists language text;
alter table bookings add column if not exists wa_message jsonb;
