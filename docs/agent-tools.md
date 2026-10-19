# Agent tools (ElevenLabs server tools)

Create one **server tool** per row in the ElevenLabs agent (Agents > Tools > Add webhook tool). Every tool is a `POST` to
`https://YOUR-HOST/api/agent-tools/<tool>` with the header `Authorization: Bearer <AGENT_TOOLS_SECRET>`
(set the same value in your environment) and a JSON body that always includes `agent_id` = the dynamic variable `system__agent_id`.

| Tool | Body fields (besides `agent_id`) | Returns |
| --- | --- | --- |
| `check_availability` | `doctor_id` (optional), `from_date` (YYYY-MM-DD, optional), `days` (1-30, default 7), `language` (`en`/`ar`) | `slots[]` with `doctor_id`, `doctor`, `start` (ISO), `label` |
| `book_appointment` | `doctor_id`, `starts_at` (ISO, from a slot), `patient_name`, `patient_phone`, `service`, `conversation_id` (`system__conversation_id`) | `bookingId`, `label` |
| `find_patient_booking` | `patient_phone` | `bookings[]` with `bookingId`, `doctor`, `label` |
| `cancel_appointment` | `booking_id`, `patient_phone` | `cancelled` |
| `reschedule_appointment` | `booking_id`, `patient_phone`, `new_starts_at` | `bookingId`, `label` |

Responses are `{ "ok": true, ... }` or `{ "ok": false, "error": "<code>", "message": "<what the agent should say or do>" }`.
Error codes: `slot_taken`, `calendar_unavailable`, `missing_details`, `not_found`, `bad_time`, `bad_date`, `unknown_doctor`.

Add to the prompt: "Always call check_availability before offering times. Never invent slots. Confirm doctor, time, name and phone number
back to the patient before calling book_appointment. If a tool returns ok:false, follow its message."

## Google Calendar

1. Google Cloud: create a service account, enable the Calendar API, download its JSON key, and set it as `GOOGLE_SERVICE_ACCOUNT_JSON` (one line).
2. In each doctor's Google Calendar: Settings and sharing > Share with the service account's email > "Make changes to events".
3. Admin > client > Doctors: paste each doctor's calendar id (Calendar settings > Integrate calendar).

Availability = the clinic's opening hours minus CallsDash bookings minus busy time on the doctor's Google Calendar.
If the calendar cannot be read the tool refuses to book and raises an alert; it never books blind.

Not built yet: WhatsApp confirmation after booking (needs the WhatsApp channel), `handoff_to_staff` and `take_message`.
