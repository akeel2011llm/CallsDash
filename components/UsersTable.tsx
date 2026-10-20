import { changeUserRoleAction, deleteUserAction, setUserDisabledAction } from "@/lib/user-actions";
import { canManage, type UserActor } from "@/lib/users";
import { fmtDateTime } from "@/lib/format";
import type { Key } from "@/lib/i18n";
import type { Locale, Profile } from "@/lib/types";
import { userFormText } from "@/lib/user-text";
import { ResetPasswordForm } from "./UserForms";
import { SubmitButton } from "./SubmitButton";
import { Badge } from "./ui";

type Row = Profile & { lastSignIn?: string };

/** The people list used by the admin Users page and the client Team page. What each row offers depends on who is looking. */
export function UsersTable({ users, tenantNames, viewer, returnTo, t, locale }: {
  users: Row[]; tenantNames?: Map<string, string>; viewer: UserActor; returnTo: string; t: (k: Key) => string; locale: Locale;
}) {
  const text = userFormText(t);
  return (
    <div className="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t("users.col.person")}</th>
            {tenantNames && <th>{t("users.client")}</th>}
            <th>{t("users.col.role")}</th><th>{t("users.col.status")}</th><th>{t("users.col.lastSignIn")}</th><th />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const manage = canManage(viewer, u) && u.id !== viewer.userId;
            const returnField = <input type="hidden" name="returnTo" value={returnTo} />;
            return (
              <tr key={u.id}>
                <td><strong>{u.fullName || u.email}</strong><br /><small className="muted" dir="ltr">{u.email}</small></td>
                {tenantNames && <td>{u.tenantId ? tenantNames.get(u.tenantId) ?? "" : "CallsDash"}</td>}
                <td><Badge tone={u.role === "admin" ? "info" : "neutral"}>{t(`users.role.${u.role}` as Key)}</Badge></td>
                <td>
                  {u.disabled ? <Badge tone="bad">{t("users.status.disabled")}</Badge>
                    : u.mustChangePassword ? <Badge tone="warn">{t("users.status.mustChange")}</Badge>
                    : <Badge tone="ok">{t("users.status.active")}</Badge>}
                </td>
                <td>{u.lastSignIn ? fmtDateTime(u.lastSignIn, locale) : <span className="muted">{t("users.never")}</span>}</td>
                <td>
                  {manage && (
                    <div className="stack" style={{ gap: ".5rem", minWidth: 220 }}>
                      <ResetPasswordForm userId={u.id} text={text} />
                      <div className="row">
                        <form action={setUserDisabledAction}>
                          <input type="hidden" name="userId" value={u.id} /><input type="hidden" name="disabled" value={u.disabled ? "0" : "1"} />{returnField}
                          <SubmitButton className="btn small ghost" type="submit">{u.disabled ? t("users.enable") : t("users.disable")}</SubmitButton>
                        </form>
                        {viewer.role === "admin" && u.role !== "admin" && (
                          <form action={changeUserRoleAction} className="row" style={{ flexWrap: "nowrap" }}>
                            <input type="hidden" name="userId" value={u.id} />{returnField}
                            <select name="role" defaultValue={u.role} aria-label={t("users.setRole")} style={{ inlineSize: "auto", paddingBlock: ".28rem" }}>
                              <option value="manager">{t("users.role.manager")}</option>
                              <option value="receptionist">{t("users.role.receptionist")}</option>
                            </select>
                            <SubmitButton className="btn small ghost" type="submit">{t("common.save")}</SubmitButton>
                          </form>
                        )}
                      </div>
                      <details>
                        <summary className="muted" style={{ cursor: "pointer" }}>{t("users.delete")}</summary>
                        <form action={deleteUserAction} className="stack" style={{ gap: ".4rem", marginBlockStart: ".5rem" }}>
                          <input type="hidden" name="userId" value={u.id} />{returnField}
                          <input name="confirmEmail" required autoComplete="off" placeholder={u.email} aria-label={t("users.delete.confirm")} dir="ltr" />
                          <small className="muted">{t("users.delete.confirm")}</small>
                          <SubmitButton className="btn small danger" type="submit">{t("users.delete")}</SubmitButton>
                        </form>
                      </details>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
