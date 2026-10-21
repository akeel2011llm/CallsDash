-- Booking system: staff notes, who made the booking, and a "completed" status.
-- The app applies this itself on start (lib/data/pg.ts); this file is for fresh databases and review.
alter table bookings add column if not exists notes text;
alter table bookings add column if not exists source text not null default 'ai';
alter table bookings drop constraint if exists bookings_status_check;
alter table bookings drop constraint if exists bookings_status_v2;
alter table bookings add constraint bookings_status_v2 check (status in ('confirmed', 'rescheduled', 'completed', 'cancelled', 'no_show'));
