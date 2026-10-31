import { requireClient } from "@/lib/auth";
import { getBookings, getDoctors } from "@/lib/data";
import { formatOf, sheetResponse } from "@/lib/sheet";

export const dynamic = "force-dynamic";

/** Bahrain local date and time (UTC+3), as the clinic reads them. */
const local = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3_600_000).toISOString();

/** Every booking as a spreadsheet: CSV, or Excel with ?format=xlsx. Same people as the Bookings screen. */
export async function GET(req: Request) {
  const { tenant } = await requireClient();
  const [bookings, doctors] = await Promise.all([getBookings(tenant.id), getDoctors(tenant.id)]);
  const names = new Map(doctors.map((d) => [d.id, d.name]));
  const rows = [...bookings].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((b) => {
    const at = local(b.startsAt);
    return [b.id, at.slice(0, 10), at.slice(11, 16), b.durationMin, names.get(b.doctorId) ?? "", b.patientName, b.patientPhone, b.patientCpr ?? "", b.service, b.status, b.source ?? "ai", b.language ?? "", b.notes ?? ""];
  });
  return sheetResponse(
    [["reference", "date", "time", "duration_min", "staff", "customer", "phone", "cpr", "service", "status", "made_by", "language", "notes"], ...rows],
    `${tenant.slug}-bookings`, formatOf(req.url), { sheet: "bookings" },
  );
}
