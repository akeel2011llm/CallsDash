import "server-only";
import { createBookingService } from "./booking";
import { bookingNotifier } from "./booking-notify";
import { getData } from "./data";
import { googleCalendarFromEnv } from "./google-calendar";

const g = globalThis as unknown as { __callsdashCalendar?: ReturnType<typeof googleCalendarFromEnv> };
/** One Google client per server instance, so its access token is reused between requests. */
export const sharedCalendar = () => (g.__callsdashCalendar ??= googleCalendarFromEnv());

/** The booking service on the real data layer and calendar, which also sends the patient's WhatsApp confirmation. Used by the agent's tools and by the dashboards. */
export async function bookingService() {
  const data = await getData();
  return createBookingService(data, sharedCalendar(), undefined, { notify: bookingNotifier({ data }) });
}
