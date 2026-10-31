-- Milestone 8b (any business): each team member (doctors table) can have one of the client's roles (Doctor, Nurse, Stylist).
-- The roles themselves live in tenants.business (jsonb). Empty = the client's first role. Applied automatically on start too.
alter table doctors add column if not exists role text;
