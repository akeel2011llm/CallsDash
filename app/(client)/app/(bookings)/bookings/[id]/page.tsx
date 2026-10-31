import { requireClient } from "@/lib/auth";
import { BookingDetailView, type BookingDetailParams } from "@/components/BookingDetailView";

export default async function BookingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<BookingDetailParams> }) {
  const { tenant, staffRole } = await requireClient();
  return <BookingDetailView base="/app" tenant={tenant} id={(await params).id} sp={await searchParams} canDelete={staffRole === "manager"} />;
}
