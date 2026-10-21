import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { authAdmin } from "@/lib/auth-admin-supabase";
import * as store from "@/lib/data";
import { listUsers, type UserActor } from "@/lib/users";
import { userFormText } from "@/lib/user-text";
import { fmtDateTime } from "@/lib/format";
import { CreateUserForm } from "@/components/UserForms";
import { UsersTable } from "@/components/UsersTable";
import { Notice, PageHead } from "@/components/ui";

export default async function Users({ searchParams }: { searchParams: Promise<{ c?: string; saved?: string; error?: string }> }) {
  const { session } = await requireAdmin();
  const { c, saved, error } = await searchParams;
  const [{ t, locale }, tenants, audit] = await Promise.all([getT(), store.listTenants(), store.getAudit()]);
  const doctors = (await Promise.all(tenants.map((x) => store.getDoctors(x.id)))).flat();
  const auth = authAdmin();
  const filter = c && tenants.some((x) => x.id === c) ? c : undefined;
  const people = auth ? await listUsers({ auth, data: store }, filter) : (await store.listProfiles(filter)).map((p) => ({ ...p, lastSignIn: undefined }));
  const viewer: UserActor = { role: "admin", label: "admin", userId: session.userId };
  const names = new Map(tenants.map((x) => [x.id, locale === "ar" ? x.branding.displayNameAr : x.name]));
  const activity = audit.filter((a) => /^(User |Password reset)/.test(a.action)).slice(0, 10);
  const returnTo = filter ? `/admin/users?c=${filter}` : "/admin/users";
  return (
    <>
      <PageHead title={t("users.title")} subtitle={t("users.subtitle")} />
      {!auth && <Notice tone="warn">{t("users.err.not_configured")}</Notice>}
      {saved && <Notice tone="ok">{t("users.saved")}</Notice>}
      {error && <Notice tone="warn">{t(`users.err.${error}` as "users.err.forbidden") ?? error}</Notice>}
      {auth && <CreateUserForm text={userFormText(t)} tenants={tenants.map((x) => ({ id: x.id, name: names.get(x.id)! }))} roles={["manager", "receptionist", "doctor", "admin"]} doctors={doctors} />}
      <form className="row" method="get">
        <label className="inline">{t("users.client")}
          <select name="c" defaultValue={filter ?? ""} style={{ inlineSize: "auto" }}>
            <option value="">{t("users.filter.all")}</option>
            {tenants.map((x) => <option key={x.id} value={x.id}>{names.get(x.id)}</option>)}
          </select>
        </label>
        <button className="btn small ghost" type="submit">{t("common.apply")}</button>
      </form>
      {people.length === 0 ? <Notice>{t("users.empty")}</Notice>
        : <UsersTable users={people} tenantNames={names} viewer={viewer} returnTo={returnTo} t={t} locale={locale} doctors={doctors} />}
      {activity.length > 0 && (
        <section className="card stack">
          <h2>{t("users.activity")}</h2>
          <div className="table-wrap"><table><tbody>
            {activity.map((a) => <tr key={a.id}><td>{fmtDateTime(a.at, locale)}</td><td>{a.actor}</td><td>{a.action}</td></tr>)}
          </tbody></table></div>
        </section>
      )}
    </>
  );
}
