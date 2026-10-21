-- The patient's CPR number (the 9-digit Bahraini ID number). Asked for every new booking; the agent finds a patient's
-- bookings by it before moving or cancelling one. Older bookings have none and are still found by phone number.
-- The app applies this itself on start (lib/data/pg.ts); this file is for fresh databases and review.
alter table bookings add column if not exists patient_cpr text;
create index if not exists bookings_patient_cpr on bookings (tenant_id, patient_cpr);
