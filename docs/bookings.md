# Bookings

One booking record per appointment, whoever made it. The record says who: the AI receptionist (`ai`), the clinic team (`staff`) or later the doctor (`doctor`).

## Receptionist screens (client app)
- `/app/bookings`: today, upcoming, past and all; search by name, phone, CPR number or booking reference (as with a phone number, what is typed in the search box is part of the page address, so clear it when done); filter by doctor and status; one-click cancel.
- `/app/bookings/new`: pick a doctor and a day, choose a free time (opening hours, existing bookings and the doctor's Google Calendar are all respected), enter the patient (name and phone are required; the CPR number can be left empty for a visitor who has none, but a number that is typed must be 9 digits) and notes. A tick-box "Send the patient a confirmation on WhatsApp" (on by default when the clinic has set WhatsApp up) and the language of the confirmation are offered here.
- `/app/bookings/[id]`: the WhatsApp confirmation (state, reason if it failed, **Send again**), notes, reschedule (with the same tick-box), mark completed, no-show, cancel, restore. WhatsApp and call links for the patient.

All of it goes through `lib/booking.ts`, the same service the AI agent's tools use, so staff and the AI can never double-book a doctor.

## Statuses
`confirmed`, `rescheduled`, `completed`, `no_show`, `cancelled`. Only `confirmed` and `rescheduled` hold the doctor's time. Restoring a cancelled booking checks the time is still free.

## WhatsApp confirmation

When a booking is made or moved, the patient gets a message on WhatsApp with every detail: clinic, doctor, service, date, time, the clinic's address (with the map link when the clinic gave one), the clinic's phone and a **booking reference**. It is sent by the same code whoever made the booking (assistant, receptionist or doctor) and always **after** the booking is saved and the answer given, so WhatsApp can never slow a booking down or undo it (`lib/booking-notify.ts`; the wording and the values are in `lib/whatsapp.ts`).

- **When one is sent.** A new booking; a booking moved to another time (by the patient through the assistant, or by staff); a booking given to another doctor, or whose phone number was corrected, by staff. Name or service fixes, cancelling, completing, no-show and restoring send nothing. Staff can untick "Send the patient a confirmation on WhatsApp" for one booking or change, and **Send again** on the booking page sends it on demand.
- **When nothing is sent, and why.** The Channels page keeps WhatsApp as Live with a phone number ID and a template, "Send booking confirmations" is on, the phone is a possible number (8 digits means Bahrain, otherwise with the country code) and the clinic has an ElevenLabs agent. When one of these is missing the booking page says which, and a clinic that does not use WhatsApp sees nothing at all.
- **Language.** The assistant passes the language the patient is speaking or writing; staff choose it on the booking. If the clinic has not made a template in that language, its main language is used. A move or a handover keeps the booking's language. Dates and times are written for Bahrain (for example "Saturday 24 October 2026", "4:00 PM", Arabic "4:00 م").
- **Reference.** The first 8 letters and digits of the booking id, in capitals (`lib/booking-ref.ts`). It is printed in the message, shown on the booking page and searchable in the bookings list.
- **What staff see.** A WhatsApp card on the booking: *Sending* (a few seconds), *Sent*, *Failed* with a plain reason and what to check, *Not sent* with the reason, or *Unknown* when a note has said "sending" for more than ten minutes. **Sent** means ElevenLabs accepted the message and handed it to WhatsApp; Meta can still decline to deliver it (for example when the number is not on WhatsApp), and that is not reported back. A failure also leaves one line in the activity log and, once, an alert for the clinic with the likely fix.
- **CPR.** The CPR number is never put in the message. A patient who replies asking to change or cancel is asked for it by the assistant, as for any other change.
- **Replies.** The reply continues in a normal WhatsApp conversation with the assistant (it is given today's date, the opening hours and the patient's number). A confirmation nobody answers is not stored as a conversation and costs no credits.
- **Cost.** Meta charges the clinic per template message delivered, on the payment method of the clinic's WhatsApp Business account. It does not use CallsDash credits.
- **Data.** `bookings.language` and `bookings.wa_message` (jsonb: status, time, reason, conversation id, language), migration `0011_booking_whatsapp.sql`; the app also applies it by itself on start.

## Google Calendar
Each booking becomes an event on the doctor's linked calendar, with the patient, phone, service, notes, who booked it, and a link back to the booking (when `NEXT_PUBLIC_SITE_URL` is set). Moving, cancelling, restoring and editing notes keep the event in step. If Google is unreachable the booking is still saved and an alert says the event was not written.

Reminders on every event (`DEFAULT_REMINDERS` in `lib/google-calendar.ts`): an email a day before, pop-ups an hour and 15 minutes before. They reach whoever owns or has the doctor's calendar notifications switched on. A service account cannot invite guests without Google Workspace domain-wide delegation, so patients are not added to the event; patient reminders go by WhatsApp once the clinic's number is linked.

## Doctor portal (`/doctor`)
A doctor gets their own sign-in (role `doctor`, tied to one of the clinic's doctors). It is created in Users (admin) or Team (clinic manager): choose Doctor, then pick which doctor it is. They land on **My day**: today's visits with one-tap Completed or No-show, the next patient, and the coming week. **Bookings** lists only their own bookings (search, today / upcoming / past); a booking opens to notes, reschedule, complete, no-show, cancel and restore. They can also add a booking for themselves (marked "Booked by doctor").

A doctor never sees other doctors' bookings, credits, conversations or settings: the portal pages and the booking actions are limited to their own doctor id on the server, and `/app` sends them back to `/doctor`. A doctor sign-in whose doctor is removed is refused at the next request.

## Managing doctors, hours, leave and holidays
- **Doctors page** (`/app/doctors` for the clinic manager, and the People tab of the admin client workspace): edit name, specialty, colour and Google Calendar ID, test the calendar, pause a doctor ("Taking new bookings" off: existing bookings stay, nobody can book them), set the doctor's own weekly hours or use the clinic's, add and remove leave (whole days), and remove the doctor (tick-box confirmation; refused while they have upcoming bookings or their own sign-in).
- **Clinic closed days** (Calendar page): public holidays when nobody can book.
- Availability (`lib/booking.ts`) uses the doctor's own hours when set, and treats leave and closed days as busy. Adding leave or a closed day says how many existing bookings fall on those days, so staff can move them.
- **Booking edits**: patient name, phone, CPR number and service (a booking made before CPR was asked can be saved with the CPR left empty); the clinic team can hand a booking to another doctor at the same time if that doctor is free (the Google event moves calendars). A doctor can fix details on their own bookings but cannot change the doctor.
- **Delete booking** (manager only, tick-box confirmation): removes the booking and its Google event with no record. Everyone else cancels, which keeps the record.
