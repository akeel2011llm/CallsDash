import { requireSection } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import * as store from "@/lib/data";
import { readServices, servicesKey } from "@/lib/services";
import { ServicesManager, type ServicesQuery } from "@/components/ServicesManager";
import { PageHead } from "@/components/ui";

/** Bookings > Services: what the business offers. The manager edits it; everyone else sees the list. */
export default async function Services({ searchParams }: { searchParams: Promise<ServicesQuery> }) {
  const { tenant, staffRole } = await requireSection("bookings");
  const { t, locale } = await getT(tenant);
  const list = readServices(await store.getSetting(servicesKey(tenant.id)).catch(() => undefined));
  return (
    <>
      <PageHead title={t("services.title")} subtitle={t("services.subtitle")} />
      <ServicesManager list={list} sp={await searchParams} t={t} locale={locale} canEdit={staffRole === "manager"} />
    </>
  );
}
