-- Second line of defence: the app already refuses a client whose name or website matches another one.
-- Run this once any accidental duplicate client has been deleted (it fails while two clients share a name).
create unique index if not exists tenants_name_unique on tenants (lower(btrim(name)));
