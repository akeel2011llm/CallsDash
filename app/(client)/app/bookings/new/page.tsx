import { requireClient } from "@/lib/auth";
import { NewBookingView, type NewBookingParams } from "@/components/NewBookingView";

export default async function NewBookingPage({ searchParams }: { searchParams: Promise<NewBookingParams> }) {
  const { tenant } = await requireClient();
  return <NewBookingView base="/app" tenant={tenant} sp={await searchParams} />;
}
