-- The agent passes ElevenLabs' conversation id ("conv_01j...") when it books, and that is not a uuid, so every booking
-- from the agent failed with "invalid input syntax for type uuid". The app applies this itself on start
-- (lib/data/pg.ts); this file is for fresh databases and review.
alter table bookings alter column conversation_id type text using conversation_id::text;
