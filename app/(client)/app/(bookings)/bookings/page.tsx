import { requireClient } from "@/lib/auth";
import { BookingList } from "@/components/BookingList";

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ doctor?: string; status?: string; view?: string; q?: string; err?: string; deleted?: string }> }) {
  const { tenant } = await requireClient();
  return <BookingList base="/app" tenant={tenant} sp={await searchParams} />;
}
