# Agent tools (ElevenLabs server tools)

Create one **server tool** per row in the ElevenLabs agent (Agents > Tools > Add webhook tool). Every tool is a `POST` to
`https://YOUR-HOST/api/agent-tools/<tool>` with the header `Authorization: Bearer <AGENT_TOOLS_SECRET>`
(set the same value in your environment) and a JSON body that always includes `agent_id` = the dynamic variable `system__agent_id`.

| Tool | Body fields (besides `agent_id`) | Returns |
| --- | --- | --- |
| `check_availability` | `doctor_id` (optional), `from_date` (YYYY-MM-DD, optional), `days` (1-30, default 7), `language` (`en`/`ar`) | `slots[]` with `doctor_id`, `doctor`, `starts_at` (ISO, pass to `book_appointment` as is), `label`; `message` when there are none |
| `book_appointment` | `doctor_id`, `starts_at` (ISO, from a slot), `patient_name`, `patient_phone`, `patient_cpr` (9 digits), `service`, `conversation_id` (`system__conversation_id`) | `bookingId`, `label` |
| `find_patient_booking` | `patient_cpr`; `patient_phone` only for bookings made before CPR was asked; `language` | upcoming `bookings[]` with `booking_id`, `doctor_id`, `doctor`, `starts_at`, `label`; `message` when there are none |
| `cancel_appointment` | `booking_id`, `patient_cpr` (`patient_phone` for an old booking) | `cancelled` |
| `reschedule_appointment` | `booking_id`, `patient_cpr`, `new_starts_at`, `doctor_id` (only to change doctor; `patient_phone` for an old booking) | `bookingId`, `doctor`, `label` |
| `take_message` | `patient_name`, `patient_phone`, `message`, `language`, `conversation_id` | `requestId`, `message` (what to tell the caller) |
| `handoff_to_staff` | `patient_name`, `patient_phone`, `reason`, `urgent` (true when it cannot wait, e.g. a medical emergency), `language`, `conversation_id` | `requestId`, `open` (clinic open now), `transferred` (always false for now), `message` |

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

Not built yet: WhatsApp confirmation after booking (needs the WhatsApp channel) and notifying staff of a message outside the dashboard.
