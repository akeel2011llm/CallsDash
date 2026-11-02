import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import * as store from "@/lib/data";
import { readServices, servicesKey } from "@/lib/services";
import { ServicesManager, type ServicesQuery } from "@/components/ServicesManager";
import { PageHead } from "@/components/ui";

/** Admin: the client's services (Business > Services), picked from the library or typed in. */
export default async function AdminServices({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ServicesQuery> }) {
  await requireAdmin();
  const { id } = await params;
  const tenant = await store.getTenant(id);
  if (!tenant) notFound();
  const { t, locale } = await getT(tenant);
  const list = readServices(await store.getSetting(servicesKey(id)).catch(() => undefined));
  return (
    <>
      <PageHead title={t("services.title")} subtitle={t("services.subtitle")} actions={<Link className="btn ghost" href={`/admin/clients/${id}/business`}>{t("common.back")}</Link>} />
      <ServicesManager tenantId={id} list={list} sp={await searchParams} t={t} locale={locale} canEdit />
    </>
  );
}
