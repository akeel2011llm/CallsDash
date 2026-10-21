import { requireDoctor } from "@/lib/auth";
import { NewBookingView, type NewBookingParams } from "@/components/NewBookingView";

export default async function DoctorNewBooking({ searchParams }: { searchParams: Promise<NewBookingParams> }) {
  const { tenant, doctor } = await requireDoctor();
  return <NewBookingView base="/doctor" tenant={tenant} doctorId={doctor.id} sp={await searchParams} />;
}
