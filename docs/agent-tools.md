# Agent tools (ElevenLabs server tools)

Create one **server tool** per row in the ElevenLabs agent (Agents > Tools > Add webhook tool). Every tool is a `POST` to
`https://YOUR-HOST/api/agent-tools/<tool>` with the header `Authorization: Bearer <AGENT_TOOLS_SECRET>`
(set the same value in your environment) and a JSON body that always includes `agent_id` = the dynamic variable `system__agent_id`.

| Tool | Body fields (besides `agent_id`) | Returns |
| --- | --- | --- |
| `check_availability` | `doctor_id` (optional), `from_date` (YYYY-MM-DD, optional), `days` (1-30, default 7), `language` (`en`/`ar`) | `slots[]` with `doctor_id`, `doctor`, `starts_at` (ISO, pass to `book_appointment` as is), `label`; `message` when there are none |
| `book_appointment` | `doctor_id`, `starts_at` (ISO, from a slot), `patient_name`, `patient_phone`, `patient_cpr` (9 digits), `service`, `language` (`en`/`ar`, the language the patient uses; optional), `conversation_id` (`system__conversation_id`) | `bookingId`, `label`, `whatsappConfirmation` |
| `find_patient_booking` | `patient_cpr`; `patient_phone` only for bookings made before CPR was asked; `language` | upcoming `bookings[]` with `booking_id`, `doctor_id`, `doctor`, `starts_at`, `label`; `message` when there are none |
| `cancel_appointment` | `booking_id`, `patient_cpr` (`patient_phone` for an old booking) | `cancelled` |
| `reschedule_appointment` | `booking_id`, `patient_cpr`, `new_starts_at`, `doctor_id` (only to change doctor; `patient_phone` for an old booking), `language` (optional) | `bookingId`, `doctor`, `label`, `whatsappConfirmation` |
| `lookup_customer` | `patient_phone`, `patient_cpr` (optional) | `found`; a returning customer gives `first_name` and `language`; with the CPR number on file repeated, `verified: true` and `name`, `email`, `notes`, `last_contact`, `recent_conversations` |
| `save_customer` | `patient_phone`, `patient_name`, `patient_cpr`, `email`, `note`, `language`, `conversation_id` | `saved`, `created` |
| `take_message` | `patient_name`, `patient_phone`, `message`, `language`, `conversation_id` | `requestId`, `message` (what to tell the caller) |
| `handoff_to_staff` | `patient_name`, `patient_phone`, `reason`, `urgent` (true when it cannot wait, e.g. a medical emergency), `language`, `conversation_id` | `requestId`, `open` (clinic open now), `transferred` (always false for now), `message` |

**Customers.** `lookup_customer` and `save_customer` work on the client's **Customers** list (`/app/customers`), found again by the last 8 digits of the phone number. A phone number alone is not proof of who is calling, so `lookup_customer` gives only the first name until the CPR number on file is repeated (`patient_cpr`); a CPR that does not match gives nothing. `save_customer` adds or updates a customer; a name, CPR or email on a customer who has a CPR on file is only changed when that CPR is repeated, a note is always added (newest last, 2000 characters kept). The assistant is told to keep medical details out of notes. After every conversation the post-call webhook adds a line to the customer's history (found by the caller's number, `caller_phone` from the start-of-conversation webhook, or by the `conversation_id` that `save_customer` linked); a caller's number with no customer yet becomes one without a name. Customers are never copied when a client is duplicated. Error codes: `bad_phone`, `bad_cpr`, `bad_email`, `cpr_mismatch`.

**Customer lookup choice.** Each clinic chooses on its Customers screen whether the assistant finds a returning customer by phone number (the default, as above) or by CPR number (`AgentSettings.customerLookup`). In CPR mode `lookup_customer` takes `patient_cpr` alone: a match is the proof, so it returns the name, notes and recent conversations, and a phone number alone finds nobody. `save_customer` then finds the customer by CPR whatever phone they use now (the phone may be left out for a CPR already known); a record made by the post-call webhook from a bare phone number (no name, no notes) takes the CPR and drops its earlier conversations. The choice changes the assistant's instructions, so the app syncs the agent after it is saved. Neither `patient_phone` nor `patient_cpr` is required by the tool schema; the server asks the assistant for whichever the clinic's mode needs.

**Catalogue.** `find_item` searches the client's **Catalogue** (`/app/catalogue`: name, Arabic name, details, price, extra words, a photo, visible or hidden) and returns up to 3 active items with details in the customer's language and, when there is a photo, an `image_url` (`/api/items/<slug>/<id>/image?v=<version>`, public, only for visible items, png/jpeg/webp only). `show_image` is a **client tool**, not a webhook: the customer's browser runs it. `public/widget.js` answers it on the `elevenlabs-convai:call` event (`event.detail.config.clientTools`) by drawing a closable photo card, and only for pictures served by this app for a catalogue item. The dashboard's "Try the assistant" panel does the same. The tool must exist on the agent with the same name, so each client needs "Update the assistant" once. On WhatsApp, Instagram and calls the assistant describes the item in words (the instructions say so). Catalogue items are never copied when a client is duplicated.

**Doctors and listing (agent version 7).** `find_item` also finds **doctors** by name or specialty (title words such as Dr and doctor are ignored; only active doctors). A doctor entry has `kind: "doctor"`, the specialty as `details`, and an `image_url` only when a photo was added on the Data screen; it uses the same public address (`/api/items/<slug>/<doctor id>/image`, ids never clash with items) and page (`/i/<slug>/<doctor id>`), and `send_item_photo` accepts the doctor's id. With an empty `query` it lists up to 5 active items, photos first, so "do you have any product photos" works. The instructions tell the assistant to call it before saying it has no photos. Each client needs "Update the assistant" once.

Agent version 8: `show_image` now has `expects_response: true` and the widgets answer `Shown.`, so a chat that cannot draw it (ElevenLabs' own preview widget does not run `public/widget.js` or the dashboard panel, so it has no `show_image` handler) gives the assistant an error, and the instructions then say to put the item's `page_url` link in the reply instead of claiming a photo was shown. The Doctors list in the instructions marks doctors with a photo `[has a photo]` (so adding or removing a doctor photo syncs the agent), and the assistant shows that photo once per doctor per conversation, on the first mention, in the website chat only. Not verified against real ElevenLabs: what an unhandled client tool returns.

Agent version 9: in a **typed** website chat the assistant puts the photo inside its reply as a markdown image on its own line, `![caption](image_url)`. ElevenLabs' widget (`@elevenlabs/convai-widget-embed`, checked with 0.22.0) renders markdown images inside the conversation itself, so this works on any page with the widget, with or without `public/widget.js`. The prompt tells typed from spoken with ElevenLabs' system variable `{{system__is_text_only}}`. In a **spoken** website conversation it still calls `show_image`, which draws a card over the chat. `public/widget.js` and the dashboard panel keep the in-chat photos small (`lib/chat-photos.ts`, added to the widget's open shadow root), and the dashboard's written test chat turns the same markdown into a picture. Not verified against a real conversation: that ElevenLabs passes the markdown through unchanged on the web widget (its docs mention a per-channel "Output format" that defaults to plain text for the widget).

**Photos outside the website chat.** `find_item` also returns `page_url`, a public page for the item (`/i/<slug>/<id>`, `?lang=ar` for Arabic) with Open Graph tags, so a WhatsApp or Instagram chat shows the photo as a link preview. This needs no setup. On WhatsApp the assistant first calls the webhook tool `send_item_photo` (`item_id`, `language`, and `caller_phone`, which ElevenLabs fills from the chat's own `caller_phone` variable so the assistant cannot choose the recipient). With a Meta access token saved on the client's Channels page (`TenantSecrets.whatsappToken`, optional) the server sends the picture through Meta's WhatsApp Cloud API (`POST graph.facebook.com/v21.0/<phone number id>/messages`, `type: image`, the public photo address as `link`, the item's name and price as caption; jpeg and png only). Without a token, with an empty `caller_phone`, a webp photo or a refusal from Meta, the tool answers `sent:false` with the item's page link and the assistant puts the link in its reply. Meta refuses a photo more than 24 hours after the customer's last message, which never applies while the assistant is answering. The token is kept apart from the tenant row and never shown again. Not verified against real Meta and ElevenLabs: that a token from the clinic's own Meta app may send through a number imported via ElevenLabs, and that ElevenLabs sends the customer's number for a WhatsApp chat.


**WhatsApp confirmation.** After `book_appointment` or `reschedule_appointment` succeeds, CallsDash sends the patient a confirmation with all the booking details on WhatsApp (see `docs/bookings.md`). The answer carries `whatsappConfirmation: true` only when one is on its way; the prompt rules tell the assistant to say so then, and to say nothing about WhatsApp otherwise. `language` decides which language the confirmation is in; a missing or unknown value uses the clinic's main language. The send happens after the answer, so it never slows the call, and the tool log notes "WhatsApp confirmation queued".

`take_message` and `handoff_to_staff` both land in the client's **Messages** inbox (handoffs first when urgent). Live call transfer needs a phone line
(phase 2); until then a handoff is a callback request and the agent must not promise an immediate transfer. For a medical emergency the agent
should tell the caller to call the emergency number (999 in Bahrain) as well as calling `handoff_to_staff` with `urgent: true`.

Responses are `{ "ok": true, ... }` or `{ "ok": false, "error": "<code>", "message": "<what the agent should say or do>" }`.
Error codes: `slot_taken`, `calendar_unavailable`, `missing_details`, `bad_cpr`, `tools_outdated`, `not_found`, `bad_time`, `bad_date`, `unknown_doctor`, `doctor_unavailable`.

**CPR numbers.** The AI always asks for the patient's CPR number, the 9-digit personal number on the Bahraini ID card
(`lib/cpr.ts` accepts spaces, dashes and Arabic digits; a number that is one digit repeated, like 000000000, is refused).
A patient proves a booking is theirs with the same CPR number to look it up, move it or cancel it. The receptionist can
leave the CPR empty for a visitor who has none; the AI is told to take a message for those, so the team books them.
Bookings made before CPR was asked have none; for those the phone number they were made with is the proof. When
`find_patient_booking` finds nothing and no phone was given, its answer tells the agent to ask for that phone number and
call again with both. The CPR number is kept in CallsDash only: it is not written into the Google Calendar event, and the
tool log keeps its last 3 digits.

**Tools out of date.** The booking tools live in ElevenLabs and are only rewritten on a Sync. If a call for `book_appointment`,
`find_patient_booking`, `cancel_appointment` or `reschedule_appointment` arrives without the `patient_cpr` field, ElevenLabs
still holds an older definition. The route then answers `tools_outdated` (the agent is told to take a message), and updates
the shared tools itself after the answer is sent (once a minute at most; `ensureSharedTools` in `lib/agent-sync.ts`). Each
client's prompt rules are still only rewritten on a Sync, so press **Update the assistant** for every client after a release
that raises `AGENT_VERSION`.

The tools forgive what models commonly get wrong: `doctor_id` may be the doctor's name ("Dr Hana") when only one doctor
matches; a time without a zone ("2026-10-23T16:00") is read as Bahrain time; a `from_date` that is already over means today.
The agent prompt lists the active doctors with their ids (lib/agent-config.ts).

## When a booking fails

If a Sync says a secret "contains a character that cannot be sent", or the Channels page shows
`AGENT_TOOLS_SECRET` (or `ELEVENLABS_INIT_SECRET` / `ELEVENLABS_API_KEY`) as Not valid, it has a space, curly quote or
hidden symbol from copy-paste. Sync saves it fine, but ElevenLabs cannot put it in a header, so every tool call fails. Use
**Make a secret** on the Channels page (made in the browser, letters and digits only), paste it into Vercel, redeploy and
press Sync.

Every tool call that reaches CallsDash is also written to the table `agent_tool_calls` (what was asked and the result; kept
30 days, phone and CPR numbers cut to the last 3 digits), so a failed booking can be read there. Common causes seen so far: a secret
with a hidden character, and a conversation id column that was a uuid while ElevenLabs sends text ids (`conv_...`).

Sync writes the tool rules into the agent's prompt (`TOOL_RULES` in `lib/agent-config.ts`). When those rules or the tools
change, `AGENT_VERSION` goes up and the client screens show **Update the assistant** until each client's agent is synced again.

## Google Calendar

1. Google Cloud: create a service account, enable the Calendar API, download its JSON key, and set it as `GOOGLE_SERVICE_ACCOUNT_JSON` (one line).
2. In each doctor's Google Calendar: Settings and sharing > Share with the service account's email > "Make changes to events".
3. Admin > client > Doctors: paste each doctor's calendar id (Calendar settings > Integrate calendar).

Availability = the clinic's opening hours minus CallsDash bookings minus busy time on the doctor's Google Calendar.
If the calendar cannot be read the tool refuses to book and raises an alert; it never books blind.

Not built yet: notifying staff of a message outside the dashboard.
