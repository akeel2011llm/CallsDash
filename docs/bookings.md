# Bookings

One booking record per appointment, whoever made it. The record says who: the AI receptionist (`ai`), the clinic team (`staff`) or later the doctor (`doctor`).

## Receptionist screens (client app)
- `/app/bookings`: today, upcoming, past and all; search by name, phone or CPR number; filter by doctor and status; one-click cancel.
- `/app/bookings/new`: pick a doctor and a day, choose a free time (opening hours, existing bookings and the doctor's Google Calendar are all respected), enter the patient (name, phone and CPR number, all required) and notes.
- `/app/bookings/[id]`: notes, reschedule, mark completed, no-show, cancel, restore. WhatsApp and call links for the patient.

All of it goes through `lib/booking.ts`, the same service the AI agent's tools use, so staff and the AI can never double-book a doctor.

## Statuses
`confirmed`, `rescheduled`, `completed`, `no_show`, `cancelled`. Only `confirmed` and `rescheduled` hold the doctor's time. Restoring a cancelled booking checks the time is still free.

## Google Calendar
Each booking becomes an event on the doctor's linked calendar, with the patient, phone, service, notes, who booked it, and a link back to the booking (when `NEXT_PUBLIC_SITE_URL` is set). Moving, cancelling, restoring and editing notes keep the event in step. If Google is unreachable the booking is still saved and an alert says the event was not written.

Reminders on every event (`DEFAULT_REMINDERS` in `lib/google-calendar.ts`): an email a day before, pop-ups an hour and 15 minutes before. They reach whoever owns or has the doctor's calendar notifications switched on. A service account cannot invite guests without Google Workspace domain-wide delegation, so patients are not added to the event; patient reminders go by WhatsApp once the clinic's number is linked.

## Doctor portal (`/doctor`)
A doctor gets their own sign-in (role `doctor`, tied to one of the clinic's doctors). It is created in Users (admin) or Team (clinic manager): choose Doctor, then pick which doctor it is. They land on **My day**: today's visits with one-tap Completed or No-show, the next patient, and the coming week. **Bookings** lists only their own bookings (search, today / upcoming / past); a booking opens to notes, reschedule, complete, no-show, cancel and restore. They can also add a booking for themselves (marked "Booked by doctor").

A doctor never sees other doctors' bookings, credits, conversations or settings: the portal pages and the booking actions are limited to their own doctor id on the server, and `/app` sends them back to `/doctor`. A doctor sign-in whose doctor is removed is refused at the next request.

## Managing doctors, hours, leave and holidays
- **Doctors page** (`/app/doctors` for the clinic manager, and the Doctors section of the admin client page): edit name, specialty, colour and Google Calendar ID, test the calendar, pause a doctor ("Taking new bookings" off: existing bookings stay, nobody can book them), set the doctor's own weekly hours or use the clinic's, add and remove leave (whole days), and remove the doctor (tick-box confirmation; refused while they have upcoming bookings or their own sign-in).
- **Clinic closed days** (Calendar page): public holidays when nobody can book.
- Availability (`lib/booking.ts`) uses the doctor's own hours when set, and treats leave and closed days as busy. Adding leave or a closed day says how many existing bookings fall on those days, so staff can move them.
- **Booking edits**: patient name, phone, CPR number and service (a booking made before CPR was asked can be saved with the CPR left empty); the clinic team can hand a booking to another doctor at the same time if that doctor is free (the Google event moves calendars). A doctor can fix details on their own bookings but cannot change the doctor.
- **Delete booking** (manager only, tick-box confirmation): removes the booking and its Google event with no record. Everyone else cancels, which keeps the record.
