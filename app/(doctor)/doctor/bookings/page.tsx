import { requireDoctor } from "@/lib/auth";
import { BookingList } from "@/components/BookingList";

export default async function DoctorBookings({ searchParams }: { searchParams: Promise<{ status?: string; view?: string; q?: string; err?: string }> }) {
  const { tenant, doctor } = await requireDoctor();
  return <BookingList base="/doctor" tenant={tenant} doctorId={doctor.id} sp={await searchParams} />;
}
