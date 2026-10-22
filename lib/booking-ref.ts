/**
 * A short reference for a booking that the patient and the clinic can read out: the first eight letters and digits of its
 * id, in capitals. It is printed in the WhatsApp confirmation and searched for in the bookings list. It is only a label to
 * find a booking by: changing or cancelling one still needs the patient's CPR number.
 */
export const bookingRef = (id: string) => id.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
