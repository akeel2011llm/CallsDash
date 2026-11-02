import { requireSection } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import * as store from "@/lib/data";
import { TeamLibraryManager, type TeamQuery } from "@/components/TeamLibraryManager";
import { PageHead } from "@/components/ui";

/** Bookings > Roles and departments. The manager edits them; everyone else sees the lists. */
export default async function Roles({ searchParams }: { searchParams: Promise<TeamQuery> }) {
  const { tenant, staffRole } = await requireSection("bookings");
  const { t, locale } = await getT(tenant);
  const doctors = await store.getDoctors(tenant.id);
  return (
    <>
      <PageHead title={t("teamlib.title")} subtitle={t("teamlib.subtitle")} />
      <TeamLibraryManager tenant={tenant} doctors={doctors} sp={await searchParams} t={t} locale={locale} canEdit={staffRole === "manager"} />
    </>
  );
}
