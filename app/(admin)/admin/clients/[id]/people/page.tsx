import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { Fold } from "@/components/Fold";
import { getBookings, getDoctors, getTenant, listProfiles } from "@/lib/data";
import { adminPermissionsAction } from "@/lib/actions";
import { DoctorsManager } from "@/components/DoctorsManager";

export default async function ClientPeople({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; cal?: string; doc?: string; clash?: string }> }) {
  const { id } = await params;
  const { saved, cal, doc, clash } = await searchParams;
  const tenant = await getTenant(id);
  if (!tenant) notFound();
  const [{ t, locale }, doctors, bookings, logins] = await Promise.all([getT(tenant), getDoctors(id), getBookings(id), listProfiles(id)]);
  const perms = [
    ["editPrompt", "admin.perm.editPrompt"], ["editVoice", "admin.perm.editVoice"],
    ["editBehaviour", "admin.perm.editBehaviour"], ["editKnowledge", "admin.perm.editKnowledge"],
    ["dataManager", "admin.perm.dataManager"],
  ] as const;
  const returnTo = `/admin/clients/${id}/people`;
  return (
    <>
      {saved && <Notice tone="ok">{t("agent.saved").split(".")[0]}.</Notice>}
      <PageHead title={t("ws.people")} actions={<Link className="btn ghost" href={`/admin/users?c=${id}`}>{t("ws.users")}</Link>} />
      <Fold id="permissions" open title={t("admin.permissions")}>
        <form action={adminPermissionsAction} className="stack">
          <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
          {perms.map(([k, label]) => (
            <label key={k} className="inline"><input type="checkbox" name={k} defaultChecked={tenant.permissions[k]} />{t(label)}</label>
          ))}
          <SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton>
        </form>
      </Fold>
      <DoctorsManager tenant={tenant} doctors={doctors} bookings={bookings} logins={logins} returnTo={returnTo} sp={{ doc, cal, clash }} t={t} locale={locale} />
    </>
  );
}
