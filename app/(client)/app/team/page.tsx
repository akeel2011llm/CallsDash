import { redirect } from "next/navigation";
import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { authAdmin } from "@/lib/auth-admin-supabase";
import * as store from "@/lib/data";
import { listUsers, type UserActor } from "@/lib/users";
import { userFormText } from "@/lib/user-text";
import { CreateUserForm } from "@/components/UserForms";
import { UsersTable } from "@/components/UsersTable";
import { Notice, PageHead } from "@/components/ui";

export default async function Team({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { tenant, staffRole, userId, viewingAsAdmin } = await requireClient();
  if (staffRole !== "manager") redirect("/app");
  const { saved, error } = await searchParams;
  const { t, locale } = await getT(tenant);
  const auth = authAdmin();
  const doctors = await store.getDoctors(tenant.id);
  const people = auth ? await listUsers({ auth, data: store }, tenant.id) : (await store.listProfiles(tenant.id)).map((p) => ({ ...p, lastSignIn: undefined }));
  // an administrator previewing the client keeps full control; a real manager only manages receptionists
  const viewer: UserActor = viewingAsAdmin ? { role: "admin", label: "admin", userId } : { role: "manager", tenantId: tenant.id, label: `staff:${tenant.id}`, userId };
  return (
    <>
      <PageHead title={t("users.team.title")} subtitle={t("users.team.subtitle")} />
      {!auth && <Notice tone="warn">{t("users.err.not_configured")}</Notice>}
      {saved && <Notice tone="ok">{t("users.saved")}</Notice>}
      {error && <Notice tone="warn">{t(`users.err.${error}` as "users.err.forbidden")}</Notice>}
      {auth && <CreateUserForm text={userFormText(t)} fixedTenantId={viewingAsAdmin ? tenant.id : undefined} roles={viewingAsAdmin ? ["receptionist", "doctor", "manager"] : ["receptionist", "doctor"]} doctors={doctors} />}
      {people.length === 0 ? <Notice>{t("users.empty")}</Notice>
        : <UsersTable users={people} viewer={viewer} returnTo="/app/team" t={t} locale={locale} doctors={doctors} />}
    </>
  );
}
