# App reorganization

The approved plan (sitemap, feature map, wizard, business types, catalog and data, Excel/CSV, orders) is copied below from the
project's proposal file. Work is done milestone by milestone, one pull request each.

## Safety net (milestone 0)

`tests/parity.test.ts` reads the code and lists every page and API route, every server action and every form field (keyed by
the action its form posts to). `tests/parity/baseline.json` is the approved list. The test fails when:

- something in the baseline is gone. If that is on purpose, write it in `tests/parity/moves.json`: a moved page as
  `"old URL": "new URL"` (and add a redirect in `next.config.ts`, which the test checks), a retired action or field with the reason.
- something new is in the code but not in the baseline. After adding it on purpose run `npm run parity:update`, which refuses
  to drop anything that is not explained in `moves.json`.

It also checks that every menu link points at a real page, and that every English text has an Arabic text (and the reverse).

## Building blocks (milestone 1)

- `components/Tabs.tsx`: link tabs (each tab has its own address), scrolls sideways on a phone, right to left in Arabic.
- `components/Stepper.tsx` + `stepperText(t)`: the progress header of a guided flow; compact on a phone.
- `lib/steps.ts`: which step is open (resume at the first unfinished one), skipped steps (not needed for this business type),
  blocked steps (earlier steps first), Back/Next, and which tab is active for an address.

## Business type (milestone 1b)

- `lib/business-types.ts`: the six types, their words (EN + AR), the setup rules per type (`rulesOf`, used by the wizard in
  milestone 5) and `relabel`, which rewrites a screen text for the client's type.
- Stored in `tenants.business` (jsonb, optional, added by the app on start; migration 0016). Missing = clinic, so every
  existing client looks exactly as before. Doctors are still stored as doctors whatever they are called on screen.
- Screens about one client call `getT(tenant)` instead of `getT()`; texts about the type itself use plain `getT()`.
- Set on New client and on the admin client page (Business type). Duplicating a client copies its type.
- Not yet: the assistant's own wording (lib/agent-config.ts) still says doctor/patient/clinic.

## Admin client workspace (milestone 2)

- `app/(admin)/admin/clients/[id]/layout.tsx`: one header (name, status, View as client) and nine tabs for every screen about
  a client. Tabs: Overview (`/`), Setup, Business, People, Catalog and data (`/data`), Assistant, Channels, Billing, Activity.
- The long client page was split, field for field: Business = account profile, business type, white-label settings (+ the
  branding studio at `/business/branding`); People = permissions + doctors; Billing = wallet, plans, credit history, top-up
  requests; Activity = audit log, versions/rollback, duplicate (`/activity/duplicate`), delete.
- Old addresses `/branding` and `/duplicate` redirect (next.config.ts, recorded in tests/parity/moves.json).
- Saves and errors return to the tab they came from (the actions' fallbacks point at the tab; forms send returnTo).
- Setup, Catalog and data, Assistant and Channels are unchanged inside; they still have their own heading and Back button
  (tidied in milestone 3).

---

# CallsDash reorganization proposal (Phase 1 audit + Phase 2 blueprint)

Status: APPROVED 2026-10-31 with the answers and 4 adjustments in Part 3. Milestones 0 and 1 in progress.
Based on the code at main (commit 6b85510), 2026-10-31. No open pull requests at the moment.

---------------------------------------------------------------------

## PART 1. What the audit found

### 1.1 Everything that exists today

**Admin portal (8 menu-level screens + 7 screens per client)**

| Menu item | What is on it |
|---|---|
| Clients (/admin) | Client table, status, setup progress, Manage, View as client, New client |
| New client (/admin/clients/new) | Only 4 fields: name, Arabic name, website, colour |
| Users (/admin/users) | All sign-ins across clients: create, temp password, reset, disable, delete, activity log |
| Packages | Package catalogue: create, edit, archive, delete (name EN/AR, type, credits, rollover %, monthly fee, per-credit price) |
| Usage | Cross-client usage and margin |
| Alerts | Open alerts list |
| Settings | Password + restore hidden guides |

Per client, reached only by the row of buttons at the top of the client page:

| Screen | What is on it |
|---|---|
| Client page (/admin/clients/[id]), 293 lines, 12 folds | Top-up requests, copy-done notice, **Try the assistant**, **Assistant check**, Wallet (top up, adjust), Profile (name, status, retention days, low-balance %), Permissions (incl. data manager), Branding (names, colour, allowed domains, zero-balance policy), Versions (rollback), Doctors (add/edit/delete, calendar, logins), Credit history, Audit log, Plans (add, renew, end), Delete client |
| Setup | 10-item checklist, business details (domain, phone, email, WhatsApp), website scan and apply, team list |
| Assistant studio | 7 sections (model, voice, conversation, hearing, safety, analysis, widget), Live read-back, Pricing fees; sub-page Profiles (read from ElevenLabs, save, preview, switch) |
| Channels | Agent connection and Sync, use another agent, Website status, WhatsApp card (template, token, photos), Instagram, Phone, Server settings (Set/Missing keys) |
| Data | Photos, catalogue, customers, knowledge, storage, export/import |
| Branding | Logo, cover, colours, layout, EN/AR wording, support contacts, report footer, hide "Powered by", preview |
| Duplicate | Copy a client (what is copied, then a checklist) |

**Client portal (18 menu items) and doctor portal (4 items)**

Home, Reports, Conversations, Needs attention, Messages, Bookings (+new, +detail), Customers (+detail, CSV), Calendar (hours, closures), Knowledge, Catalogue (+detail), Data (if allowed), Agent (prompt, temperature, reply length, formality, Arabic style), Voice (per language), Website widget, Credits (plans, batches, usage, history, top-up request), Doctors, Team, Settings.
Doctor portal: Today, Bookings, New booking, Settings.

Not UI but must stay untouched: /api/agent-tools, /api/webhooks (ElevenLabs, Instagram), /api/widget, /api/brand, /api/data, /api/items, /api/health, login/forgot/auth callback, /i/[slug]/[id] photo page.

### 1.2 Pain points (with where they are in the code)

1. **Same fields in several places.**
   - Support phone / email / WhatsApp: Setup page "details" AND Branding page.
   - Display name / colour: client page "Branding" fold AND Branding page (the fold even links to the page).
   - Agent temperature, voices, widget: client "Agent", "Voice", "Website" pages AND admin Assistant studio.
2. **The same thing is managed in two portals under different names.** Doctors: admin client page and client "Doctors". Users: admin "Users", client "Team", plus a read-only list on the Setup page. Credits: admin client Wallet/Plans and client "Credits". "Needs attention" (client) vs "Alerts" (admin).
3. **The client page is a 12-fold dumping ground.** Billing, identity, permissions, doctors, audit, rollback and "Delete client" all sit on one scroll. Seven further screens are only reachable from a row of 7 buttons.
4. **The 10-step setup is a list of links, not a flow.** Steps jump between 5 pages and use anchors (#details, #website, #team, #doctors). Step 5 (hours) is a manual tick. Nothing forces order or explains prerequisites. "Create client" ends on the big page, not in the setup.
5. **Billing is split four ways:** Packages (catalogue), Usage (margin), client Wallet/Plans, and top-up requests (a notice at the top of the client page).
6. **Client "Assistant" is split five ways:** Knowledge, Catalogue, Data, Agent, Voice, Website are six separate menu items about one assistant.
7. **Channels page mixes per-client channels with global server keys** ("Server settings"), which belong to the whole platform.
8. **Admin "Settings" is nearly empty** while platform-wide settings (ElevenLabs fees, model list, server keys) live inside client screens.

---------------------------------------------------------------------

## PART 2. Proposal

### 2.1 Sitemap: current vs proposed

**Admin menu: 6 items becomes 5, and the client becomes a workspace**

| Current | Proposed |
|---|---|
| Clients | **Clients** (list + health + New client wizard) |
| Users | **People** (all users; same screen, plus filter by client) |
| Packages | **Billing** hub: tabs Packages, Usage and margin, Top-up requests |
| Usage | (moved into Billing) |
| Alerts | **Alerts** (unchanged, clearer name "Alerts") |
| Settings | **Platform settings**: Account, Guides, Server keys (moved from Channels), ElevenLabs fees and model list (moved from studio "Pricing") |

**Admin client workspace** (one page with a tab bar, replacing the row of 7 buttons):

| Tab | Contains |
|---|---|
| Overview | Status, setup progress, top-up requests, Assistant check, Try the assistant, quick actions (View as client, Duplicate) |
| Setup | The guided wizard (see 2.3) |
| Business | Profile, contact details, website scan, branding (logo, cover, colours, wording), opening hours and closures |
| People | Doctors (with calendars and logins), staff users, permissions |
| Assistant | Content (knowledge, catalogue, data hub), Behaviour (prompt, temperature, style), Voice, Studio sections, Profiles |
| Channels | Agent connection, Website, WhatsApp, Instagram, Phone |
| Billing | Wallet, plans, credit history, adjust, top-up |
| Activity and danger | Audit log, versions and rollback, duplicate, delete |

**Client menu: 18 items become 7 groups**

| Current (18) | Proposed |
|---|---|
| Home | **Home** |
| Conversations, Needs attention, Messages | **Inbox** (tabs: Conversations, Needs attention, Messages) |
| Bookings, Calendar, Doctors | **Bookings** (tabs: Bookings, Calendar and hours, Doctors) |
| Customers | **Customers** |
| Knowledge, Catalogue, Data, Agent, Voice, Website | **Assistant** (tabs: Knowledge and catalogue, Behaviour, Voice, Website widget, Data and photos) |
| Reports | **Reports** |
| Credits | **Billing** (credits, plans, usage, history, top-up request) |
| Team, Settings | **Settings** (Team, Account, Guides) |

Doctor portal stays 4 items (it is already small), only with the same tab/step components.

Old URLs keep working through redirects, so bookmarks, emails and the widget do not break.

### 2.2 Feature consolidation map (proves nothing is lost)

| Feature today | Where it lives today | Where it moves |
|---|---|---|
| Client list, status, progress, View as, Manage | Admin > Clients | Clients (same) |
| Create client (4 fields) | Clients > New | Setup wizard step 1, or "Copy from an existing client" |
| Duplicate client + checklist guide | /duplicate | Activity tab (and offered in wizard step 1) |
| Delete client (typed name) | Client page fold | Activity and danger tab |
| Wallet, top-up, adjust credits | Client page | Billing tab |
| Plans add/renew/end, PlanPicker | Client page | Billing tab |
| Credit history | Client page | Billing tab |
| Top-up requests approve/decline | Notice on client page | Billing tab + Overview badge + Billing hub tab |
| Profile: name, status, retention, low-balance % | Client page | Business tab |
| Permissions (incl. data manager) | Client page | People tab |
| Display names EN/AR, colour (duplicate) | Client page fold + Branding page | Business tab > Branding (one copy) |
| Allowed domains, zero-balance policy | Client page "Branding" fold | Business tab (domains), Billing tab (zero-balance policy) |
| Logo, cover, colours, layout, wording, report footer, hide Powered by, preview | Branding page | Business tab > Branding |
| Support phone, email, WhatsApp, domain (duplicate) | Setup page + Branding page | Business tab > Contact (one copy) |
| Website scan + apply | Setup page | Business tab and wizard step 1 |
| Versions and rollback | Client page | Activity tab |
| Audit log | Client page | Activity tab |
| Try the assistant, Assistant check | Client page (top) | Overview tab, repeated in wizard final step |
| Doctors add/edit/delete, calendar test, logins | Client page + client Doctors | People tab (admin), Bookings > Doctors (client) |
| Staff users (create, reset, disable, delete) | Admin Users + client Team + Setup list | People hub (global) and People tab (per client); client Settings > Team |
| Opening hours and closures | Client Calendar | Business tab (admin), Bookings > Calendar and hours (client) |
| Knowledge base | Client Knowledge, Data | Assistant > Knowledge and catalogue |
| Catalogue and photos | Client Catalogue, Data | Assistant > Knowledge and catalogue / Data and photos |
| Customers table and CSV | Client Customers, Data | Customers (unchanged), Data tab keeps import/export |
| Prompt, temperature, reply length, formality, Arabic style | Client Agent | Assistant > Behaviour (admin Studio "Conversation" shows the same values, one source) |
| Voice per language | Client Voice | Assistant > Voice |
| Widget settings and preview | Client Website + studio Widget | Assistant > Website widget |
| Studio: model, voice, conversation, hearing, safety, analysis, widget; live read-back; profiles | Admin Assistant | Admin client > Assistant tab (all 7 sections + Profiles kept) |
| ElevenLabs fees, model list | Studio "Pricing" | Platform settings |
| Agent sync, use another agent | Channels | Channels tab |
| WhatsApp template/token/photos, Instagram, Phone, Website status | Channels | Channels tab (one Fold each, with status badges) |
| Server keys Set/Missing | Channels | Platform settings |
| Package catalogue CRUD | Admin Packages | Billing hub > Packages |
| Usage and margin | Admin Usage | Billing hub > Usage and margin |
| Alerts | Admin Alerts | Alerts |
| Conversations, detail, replay, flags | Client | Inbox > Conversations |
| Needs attention + rules | Client | Inbox > Needs attention |
| Messages (callback requests) | Client | Inbox > Messages |
| Bookings list/new/detail | Client | Bookings > Bookings |
| Reports + CSV | Client | Reports |
| Credits, batches, usage, history | Client | Billing |
| Account password, restore guides | /account, Settings | Settings (and Platform settings for admin) |
| EN/AR switch, RTL, install prompt, build badge | Shell | Shell (unchanged) |

I will convert this table into an automated parity check before any move (see milestone 0), so 0% loss is tested, not just promised.

### 2.3 Workflow designs

**A. Create a client and take it to Live (one wizard, saved after every step, can be left and resumed)**

Header shows 5 phases with ticks; "Next" is disabled until the phase's required items are valid; each phase reuses the existing forms.

1. **Business.** Name EN/AR, website, contact details, logo and colour. Option to scan the website to pre-fill, or to copy an existing client. Done when: name + website + one contact.
2. **Plan and credits.** Pick a package from the catalogue, top up, set zero-balance policy. Done when: active plan and balance above 0.
3. **People.** Add doctors (calendar + hours), connect Google Calendar, create the manager's sign-in. Done when: a doctor with a working calendar, and a user.
4. **Assistant.** Knowledge (scan or add), catalogue, behaviour and voice (start from a profile), then "Sync to ElevenLabs". Done when: agent is synced and there is knowledge.
5. **Channels and test.** Website widget first, then WhatsApp, Instagram, Phone (each optional, can be skipped with a note). Then the built-in Try the assistant test and the Assistant check. Finish button **Go live** sets status to live; if checks fail it says exactly which one.

Existing clients open the same wizard at the first unfinished phase. The old checklist becomes the progress bar, using the same ten items, so stored progress is kept.

**B. Assistant and channel configuration inside the wizard** is phase 4 and 5 above. For people who want everything, the Assistant and Channels tabs still hold every option.

**C. Billing, packages, top-ups, margin**

- Platform level (Billing hub): Packages, Usage and margin, Top-up requests (all clients, approve or decline there).
- Client level (Billing tab): wallet, plans, history, adjust.
- Client portal (Billing): same numbers with request-top-up.
Each shows the same margin colours as today.

### 2.4 Implementation plan (each milestone is one pull request, tests and build green before the next)

| # | Milestone | Risk |
|---|---|---|
| 0 | **Safety net.** Automated parity list (every route, every form field name, every translation key used) and run it after each milestone. No behaviour change. | none |
| 1 | **Shared building blocks.** Tabs component and Stepper component (mobile 390 px, Arabic RTL). Not used yet. | none |
| 2 | **Admin client workspace.** One page with the tab bar wrapping the existing screens as they are. Old URLs redirect. | low |
| 3 | **Remove duplicates.** One copy each of branding, contact details, behaviour/voice/widget values. Data stays in the same columns, so no migration. | medium |
| 4 | **Admin Billing hub and Platform settings.** Packages + Usage + Top-up requests together; fees, models, server keys move to Platform settings. | low |
| 5 | **Setup wizard** (new client + resume for existing). | medium |
| 6 | **Client portal regroup** (18 items into 7 groups with tabs). | medium |
| 7 | **Clean up.** Remove dead pages and old routes after redirects have been live a while; docs and guides updated. | low |
| 8 | **QA pass.** Every screen at 390 px in English and Arabic, add/edit/delete check on every item. | none |

Database: no destructive change. Wizard progress reuses the existing onboarding data. If one small column is needed it will be added as an optional migration.

### 2.5 Overlap and risks

- No pull requests are open now. The other build thread ("Build CallsDash phase 1") is still active; it keeps touching the biggest files I would change (client page, lib/i18n.ts, studio pages). To avoid conflicts I suggest it pauses UI changes, or merges its work before milestone 2, and that new features wait for the matching milestone.
- All text exists in both languages in one big file (lib/i18n.ts); every milestone adds EN + AR keys together, and the existing key-scan tests will catch gaps.
- Webhooks and agent tool routes are not touched, so live calls, WhatsApp and Instagram are not at risk.

### 2.6 Decisions I need from you

1. **Approve the sitemap** (admin 5 items + client workspace tabs; client 7 groups)? Recommended: yes.
2. **Wizard for new clients only, or also for existing ones?** Recommended: both (existing clients resume at the first unfinished phase).
3. **Client "Doctors" under Bookings, or under Settings?** Recommended: under Bookings, because that is where doctors are used every day.

---------------------------------------------------------------------

## PART 3. Approved answers and adjustments (AqeelLLM, 2026-10-31)

Answers: sitemap approved; wizard for new AND existing clients; client "Doctors" goes under Bookings and stays in step with admin People.

### 3.1 Business type (multi-industry)
- New per-client setting **Business type**, chosen in wizard phase 1: Clinic, Beauty salon / spa, Retail / e-commerce, Restaurant, Service business, Custom.
- Each type is a template that sets: the name of the people/resources ("Doctors", "Stylists", "Staff", "Resources", or a custom word, EN + AR), the name of a booking ("Appointment", "Order", "Reservation"), which catalog fields are on by default, and which wizard checks are required.
- Storage: one optional field on the client (no change to existing data; existing clients default to Clinic). The doctors table and routes stay exactly as they are; only the words on screen and the wizard rules change.
- Menus use the template words: client menu "Bookings > Doctors" shows as "Bookings > Stylists" for a salon; for retail with no staff scheduling the tab is hidden until switched on.

### 3.2 Catalog and data as a first-class area
- **Client menu gets its own item "Catalog and data"** (between Customers and Assistant). Tabs: Items (products / services / packages / offers, with photo, price, stock), Custom tables, Photos, Import and export. The Assistant group keeps only Knowledge, Behaviour, Voice, Website widget.
- **Admin client workspace gets its own tab "Catalog and data"** (8 tabs become 9): define the data structure (custom tables and their fields: text, number, price, stock, photo, yes/no, choice, date), set who may edit (the current data-manager permission moves here), and manage the items. No more jumping between Assistant and People.
- Assistant side: the existing find_item / show_image / send_item_photo tools keep working; custom tables get a matching search tool later. Photo matching, live stock and payment links are planned on top of this structure.

### 3.3 Excel and CSV everywhere
- One shared import/export module for every table: Catalog items, Custom tables, Customers, Bookings/Orders, Reports. Each offers: Export CSV, Export Excel (.xlsx), Download template (CSV and Excel), Import (CSV or Excel), with a preview of bad rows before saving. Image URLs are allowed as a column.
- The current CSV rules (500 rows, match by name/phone, blank cell keeps the stored value) stay.

### 3.4 Bookings ready for orders and payments
- The Bookings area is built as "Bookings and orders" with a Type filter (Appointment, Order, Reservation) and a Payment column (None, Pending payment, Paid, Refunded). Clinic screens look the same as today until a payment exists.
- Alerts gets a "Pending payments" category. Billing stays about CallsDash credits; customer payments live with bookings/orders.
- The database change (optional type and payment-status columns) is added only when orders are built, and is non-destructive.

### 3.5 Wizard rules per business type
- Phase 3 "People and resources": Clinic needs at least one doctor with a working calendar. Salon needs at least one staff member with a calendar. Retail needs nothing here (the phase shows "Not needed for retail" and can be ticked as done); if staff scheduling is on, it needs one. Custom: admin chooses.
- Phase 4 "Assistant and content": everyone needs the assistant synced. Clinic and Service need knowledge OR catalog items; Salon and Retail need at least one catalog item (products / packages). Knowledge is recommended, not required, for them.

### 3.6 Updated milestone list
| # | Milestone |
|---|---|
| 0 | Safety net (parity check) |
| 1 | Shared Tabs and Stepper |
| 1b | Business type setting + word templates (labels only, no screen moves) |
| 2 | Admin client workspace (9 tabs incl. Catalog and data) |
| 3 | Remove duplicate fields |
| 4 | Billing hub + Platform settings |
| 5 | Setup wizard with per-type rules |
| 6 | Client portal regroup (incl. Catalog and data item, Bookings and orders) |
| 6b | Excel + CSV import/export for every table |
| 6c | Custom tables (data structures) defined by admin, filled by client |
| 7 | Clean up |
| 8 | QA at 390 px EN + AR |
Orders/payment status and the payment gateway come after this, on top of 6c.
