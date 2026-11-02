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
import { AccessEditor } from "@/components/AccessEditor";
import { accessKey, readAccess } from "@/lib/access";

export default async function Team({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; access?: string }> }) {
  const { tenant, staffRole, userId, viewingAsAdmin } = await requireClient();
  if (staffRole !== "manager") redirect("/app");
  const { saved, error, access } = await searchParams;
  const { t, locale } = await getT(tenant);
  const auth = authAdmin();
  const doctors = await store.getDoctors(tenant.id);
  const people = auth ? await listUsers({ auth, data: store }, tenant.id) : (await store.listProfiles(tenant.id)).map((p) => ({ ...p, lastSignIn: undefined }));
  const rules = readAccess(await store.getSetting(accessKey(tenant.id)).catch(() => undefined));
  // an administrator previewing the client keeps full control; a real manager only manages receptionists
  const viewer: UserActor = viewingAsAdmin ? { role: "admin", label: "admin", userId } : { role: "manager", tenantId: tenant.id, label: `staff:${tenant.id}`, userId };
  return (
    <>
      <PageHead title={t("users.team.title")} subtitle={t("users.team.subtitle")} />
      {!auth && <Notice tone="warn">{t("users.err.not_configured")}</Notice>}
      {saved && <Notice tone="ok">{t("users.saved")}</Notice>}
      {error && <Notice tone="warn">{t(`users.err.${error}` as "users.err.forbidden")}</Notice>}
      <AccessEditor rules={rules} people={people} t={t} saved={access === "saved"} />
      {access === "gone" && <Notice tone="warn">{t("access.gone")}</Notice>}
      {auth && <CreateUserForm text={userFormText(t)} fixedTenantId={viewingAsAdmin ? tenant.id : undefined} roles={viewingAsAdmin ? ["receptionist", "doctor", "manager"] : ["receptionist", "doctor"]} doctors={doctors} />}
      {people.length === 0 ? <Notice>{t("users.empty")}</Notice>
        : <UsersTable users={people} viewer={viewer} returnTo="/app/team" t={t} locale={locale} doctors={doctors} />}
    </>
  );
}
