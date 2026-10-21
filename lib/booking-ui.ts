import { ToolError, type BookingService } from "./booking";
import { dayKey } from "./format";

/** Today's date in Bahrain as YYYY-MM-DD. */
export const todayKey = () => dayKey(new Date().toISOString());

/** Every free start time for one doctor on one day, for the pickers in the dashboards. */
export async function daySlots(svc: BookingService, tenantId: string, doctorId: string, date: string): Promise<{ slots: string[]; error?: string }> {
  try {
    const r = await svc.checkAvailability(tenantId, { doctorId, fromDate: date, days: 1, limit: 60 });
    return { slots: r.slots.map((s) => s.start).filter((s) => dayKey(s) === date) };
  } catch (e) {
    if (e instanceof ToolError) return { slots: [], error: e.code };
    throw e;
  }
}

export const BOOKING_ERRORS = ["slot_taken", "missing_details", "bad_time", "bad_date", "calendar_unavailable", "not_found", "not_active", "bad_status", "unknown_doctor"] as const;
export type BookingError = (typeof BOOKING_ERRORS)[number];
export const isBookingError = (v: unknown): v is BookingError => (BOOKING_ERRORS as readonly string[]).includes(String(v));
