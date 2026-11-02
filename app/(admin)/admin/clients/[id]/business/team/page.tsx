import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import * as store from "@/lib/data";
import { TeamLibraryManager, type TeamQuery } from "@/components/TeamLibraryManager";
import { PageHead } from "@/components/ui";

/** Admin: the client's roles and departments (Business > Roles and departments), from the library or typed in. */
export default async function AdminTeamLibrary({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<TeamQuery> }) {
  await requireAdmin();
  const { id } = await params;
  const tenant = await store.getTenant(id);
  if (!tenant) notFound();
  const { t, locale } = await getT(tenant);
  const doctors = await store.getDoctors(id);
  return (
    <>
      <PageHead title={t("teamlib.title")} subtitle={t("teamlib.subtitle")} actions={<Link className="btn ghost" href={`/admin/clients/${id}/business`}>{t("common.back")}</Link>} />
      <TeamLibraryManager tenant={tenant} doctors={doctors} sp={await searchParams} t={t} locale={locale} canEdit admin />
    </>
  );
}
