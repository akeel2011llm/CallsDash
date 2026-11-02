-- Departments (2026-11-02): each team member (doctors table) can belong to one of the client's departments (Denting, Paediatrics...).
-- The departments themselves live in tenants.business (jsonb). Empty = no department. Applied automatically on start too.
alter table doctors add column if not exists department text;
