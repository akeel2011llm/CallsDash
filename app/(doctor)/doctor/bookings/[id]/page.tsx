import { requireDoctor } from "@/lib/auth";
import { BookingDetailView, type BookingDetailParams } from "@/components/BookingDetailView";

export default async function DoctorBooking({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<BookingDetailParams> }) {
  const { tenant, doctor } = await requireDoctor();
  return <BookingDetailView base="/doctor" tenant={tenant} doctorId={doctor.id} id={(await params).id} sp={await searchParams} />;
}
