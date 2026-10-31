-- Any business, step 3 (Recordings screen): when staff deleted a conversation's recording at ElevenLabs. The transcript and
-- summary stay in CallsDash. Applied automatically on start too.
alter table conversations add column if not exists recording_deleted_at timestamptz;
