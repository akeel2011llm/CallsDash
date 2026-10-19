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
| Supabase schema with row-level security (`supabase/migrations/0001_init.sql`) | Written, not yet applied to a live project |

## Not in phase 1 yet

- **Supabase data adapter and Supabase Auth.** The app currently reads and writes `lib/store.ts`, an in-memory demo store that resets on restart. The adapter replaces that module behind the same function names.
- Google Calendar sync and the agent tools (`check_availability`, `book_appointment`, ...). The calendar page shows the CallsDash booking records.
- Pushing agent settings and knowledge to ElevenLabs. Saving creates a version and audit entry only.
- WhatsApp, Instagram bridge and phone (phases as per plan), outbound reminders, online payment.

## Run it

```bash
cp .env.example .env.local   # DEMO_MODE=true gives sign-in with sample data
npm install
npm run dev                  # http://localhost:3000
npm test                     # credits wallet and webhook tests
```

Demo mode shows a login page with the admin and each sample clinic. **Never set `DEMO_MODE=true` on a real deployment**: it replaces authentication with a cookie.

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
