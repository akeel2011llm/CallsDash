# Handling the database: information and images

CallsDash keeps its information in the Supabase project (Postgres). Only the app writes to it; people use the dashboard screens.

## Where things live

| What | Where | Notes |
| --- | --- | --- |
| Clients, plans, wallet, bookings, conversations, customers, messages, settings | Supabase tables | Edit them in the dashboard screens, not in Supabase |
| Catalogue photos | Supabase table `items`, column `image` (the photo itself, shrunk to under 700 KB in the browser) | Shown through `/api/items/<clinic>/<item>/image` and the item page `/i/<clinic>/<item>` |
| Call recordings (audio) | ElevenLabs, not Supabase | Kept for the clinic's retention period (90 days by default) |
| Logos and covers | Part of the client's branding | Change them on the client's Branding screen |
| Passwords | Supabase Auth | Never visible to anyone, reset from the Users screen |
| Keys and secrets | Vercel environment variables, and the per-client secrets table (only the server key can read it) | Never paste them in chat |

## Everyday rules

1. Add, change and delete things in the dashboard (clients, doctors, customers, catalogue, knowledge). Every change there is checked, confirmed and written to the history.
2. Do not edit rows by hand in Supabase's Table Editor for clients, wallet, plans or bookings. A hand edit skips the checks and the history and can break credits or the calendar.
3. Do not delete or rename a table or column. When the app needs a new one it creates it by itself on start.
4. To look at something safely, Supabase's Table Editor can be used read-only: open the table and look, do not type into cells.

## Images

- One photo per catalogue item. Open Catalogue, open the item, choose a new photo: the old one is replaced.
- The browser shrinks a photo before it is sent (a limit of 700 KB, png, jpeg or webp). Very large photos are refused with a message.
- Hiding an item or deleting it stops its photo address from working at once.
- Each photo takes up to 700 KB of database space. The free Supabase plan holds 500 MB in total, so about 600 photos at the maximum, far more at a normal size. If a clinic needs thousands of photos, move them to Supabase Storage (a later change, not needed now).

## Backups and exports

- Customers: Customers screen, CSV button, downloads the list.
- Everything else: Supabase keeps backups only on paid plans (daily, for a few days). On the free plan there is no automatic backup, so before the first real clinic goes live move the project to a paid plan, or ask for an export routine to be built.
- A full copy can be made from the Supabase project under Database, then Backups (paid plans). The exact button names change, check them on screen.

## Retention and privacy

- Audio is kept by ElevenLabs for the retention days set for the client (Client page, Profile). Text transcripts and customers stay in the database until deleted.
- Deleting a customer in the dashboard removes it for good. Deleting a client removes all its information; the screen asks for the client's name first.
- CPR numbers are health-adjacent personal data. They are never put in WhatsApp messages, calendar events or web addresses.
