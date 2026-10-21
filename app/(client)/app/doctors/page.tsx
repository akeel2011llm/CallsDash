import { redirect } from "next/navigation";
import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getBookings, getDoctors, listProfiles } from "@/lib/data";
import { DoctorsManager, type DoctorNotice } from "@/components/DoctorsManager";
import { PageHead } from "@/components/ui";

export default async function DoctorsPage({ searchParams }: { searchParams: Promise<DoctorNotice> }) {
  const { tenant, staffRole } = await requireClient();
  if (staffRole !== "manager") redirect("/app");
  const [{ t, locale }, doctors, bookings, logins, sp] = await Promise.all([getT(), getDoctors(tenant.id), getBookings(tenant.id), listProfiles(tenant.id), searchParams]);
  return (
    <>
      <PageHead title={t("doctors.title")} subtitle={t("doctors.subtitle")} />
      <DoctorsManager tenant={tenant} doctors={doctors} bookings={bookings} logins={logins} returnTo="/app/doctors" sp={sp} t={t} locale={locale} />
    </>
  );
}
