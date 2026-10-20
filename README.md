# CallsDash

White-label AI voice receptionist platform for clinics in Bahrain, built on ElevenLabs Agents. One Next.js app serves two editions: the **admin dashboard** (you) and the **client dashboard** (each clinic, in its own brand). English and Arabic UI with full right-to-left layout.

Implementation plan: see the project's "CallsDash Implementation Plan" doc.

## What phase 1 contains

| Area | Status |
| --- | --- |
| Admin: client list with health, create client, wallet top-up, package renewal, permissions, branding, allowed domains, agent version history with rollback, audit log, usage and margin, alerts, view as client | Working on demo data |
| Client: home, conversations (search, transcript, recording player), bookings, week calendar, knowledge base, prompt sections, behaviour (temperature, length, formality, Gulf/MSA written Arabic), voice, credits, widget snippet | Working on demo data |
| Credits wallet: batches, 12-month expiry, oldest first, package rollover capped at 50% (used first, one month only), low-balance alert at 15% | Working, 11 unit tests (`lib/credits.ts`) |
| Website widget (`/widget.js`): consent notice first, then the ElevenLabs widget for the clinic's agent; domain allow-list; paused when credits run out | Working; ElevenLabs agent id still a placeholder |
| ElevenLabs post-call webhook: signature check, idempotent charge, credit deduction | Working; payload field names to confirm on the first real call |
| Supabase schema with row-level security (`supabase/migrations/0001_init.sql`) | Tested on an in-process Postgres: RLS isolation, 90-day purge, Arabic search |
| Postgres data layer (`lib/data/pg.ts`), used when `DATABASE_URL` is set | Tested on Postgres: wallet, rollover, expiry, idempotent webhook, versions; the whole UI was clicked through on it |
| Booking tools for the agent (`/api/agent-tools/*`): availability, book, find, cancel, reschedule; opening hours, double-booking guard, phone check, never books blind | Tested on Postgres with a fake calendar, including a simultaneous-booking race; see `docs/agent-tools.md` |
| Google Calendar client (service account, free/busy, create, move, delete events) | Tested against a fake Google API only, **not** against a real calendar |
| Supabase Auth sign-in (email + password; role and clinic from `profiles`) | Written, **not tested** against a real Supabase project |

## Not in phase 1 yet

- Recording playback from Supabase Storage (signed links) and the "unanswered questions" list in production (both empty until built).
- WhatsApp confirmation after booking, `handoff_to_staff` and `take_message` tools, and an opening-hours editor (hours are a per-client database value, default Sat-Thu 08:00-21:00, Fri 16:00-21:00).
- Pushing agent settings and knowledge to ElevenLabs. Saving creates a version and audit entry only.
- WhatsApp, Instagram bridge and phone (phases as per plan), outbound reminders, online payment.

## Run it

```bash
cp .env.example .env.local   # DEMO_MODE=true gives sign-in with sample data
npm install
npm run dev                  # http://localhost:3000
npm test                     # credits wallet and webhook tests
```

## Going live on Supabase

1. Create a Supabase project, run `supabase/migrations/0001_init.sql` in the SQL editor.
   Optional, after any accidental duplicate client is deleted: run `supabase/migrations/0002_unique_client_name.sql` (database-level guard against two clients with the same name; the app already blocks duplicate names and websites).
   Package catalogue and several plans per client need one extra column and table; the app creates them itself on start (`supabase/migrations/0003_packages.sql` has the same statements if you prefer to run them by hand).
2. Set `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and remove `DEMO_MODE`.
3. Create your admin user in Supabase Auth, then link it:
   ```sql
   insert into profiles (id, role) values ('<auth user uuid>', 'admin');
   ```
   Clinic staff: `insert into profiles (id, tenant_id, role) values ('<uuid>', '<tenant uuid>', 'manager');`
4. Optional sample data: `DATABASE_URL=... npx tsx scripts/seed-db.ts`.

Local Postgres without Supabase: `npx tsx scripts/pglite-server.mts` starts an in-process Postgres on port 5433 with the migration applied (`PG_POOL_MAX=1` for the app, it accepts one connection).

Demo mode shows a login page with the admin and each sample clinic. **Never set `DEMO_MODE=true` on a real deployment**: it replaces authentication with a cookie. A production build with `DATABASE_URL` set ignores it.

## Defaults chosen where the plan was silent

- 1 credit = 1 voice minute = 20 text messages. Voice billed per second, text per message, both rounded to 0.01 credit.
- Spend order: rollover, then the current package, then top-ups oldest first.
- Currency BHD; USD to BHD at 0.377. Provider cost estimate = ElevenLabs $0.08/min + $0.05/min LLM allowance, $0.003 + $0.002 per text message.
- Bahrain time (UTC+3) for display; calendar week starts Sunday, 08:00 to 20:00.
- Clinic permissions default to all editable; the admin can lock prompt, voice, behaviour or knowledge per client.
- Widget asks for consent before loading anything from ElevenLabs; the choice is remembered in the visitor's browser.

## Embedding the widget

```html
<script src="https://YOUR-HOST/widget.js" data-tenant="al-noor" async></script>
```

The page's domain must be in the client's allowed domains (admin > client > branding).

## Webhook

Point the ElevenLabs post-call webhook to `https://YOUR-HOST/api/webhooks/elevenlabs` and set `ELEVENLABS_WEBHOOK_SECRET`. Requests without a valid `ElevenLabs-Signature` are rejected.
