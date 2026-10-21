# Bookings

One booking record per appointment, whoever made it. The record says who: the AI receptionist (`ai`), the clinic team (`staff`) or later the doctor (`doctor`).

## Receptionist screens (client app)
- `/app/bookings`: today, upcoming, past and all; search by name or phone; filter by doctor and status; one-click cancel.
- `/app/bookings/new`: pick a doctor and a day, choose a free time (opening hours, existing bookings and the doctor's Google Calendar are all respected), enter the patient and notes.
- `/app/bookings/[id]`: notes, reschedule, mark completed, no-show, cancel, restore. WhatsApp and call links for the patient.

All of it goes through `lib/booking.ts`, the same service the AI agent's tools use, so staff and the AI can never double-book a doctor.

## Statuses
`confirmed`, `rescheduled`, `completed`, `no_show`, `cancelled`. Only `confirmed` and `rescheduled` hold the doctor's time. Restoring a cancelled booking checks the time is still free.

## Google Calendar
Each booking becomes an event on the doctor's linked calendar, with the patient, phone, service, notes, who booked it, and a link back to the booking (when `NEXT_PUBLIC_SITE_URL` is set). Moving, cancelling, restoring and editing notes keep the event in step. If Google is unreachable the booking is still saved and an alert says the event was not written.

Reminders on every event (`DEFAULT_REMINDERS` in `lib/google-calendar.ts`): an email a day before, pop-ups an hour and 15 minutes before. They reach whoever owns or has the doctor's calendar notifications switched on. A service account cannot invite guests without Google Workspace domain-wide delegation, so patients are not added to the event; patient reminders go by WhatsApp once the clinic's number is linked.
