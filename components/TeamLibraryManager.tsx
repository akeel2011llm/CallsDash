import { businessOf, departmentName, departmentsOf, kindChoice, roleName, roleOf, rolesOf } from "@/lib/business-types";
import { TEAM_LIBRARY, searchDepartments, searchRoles, suggestedGroups, type TeamLibraryGroup } from "@/lib/team-library";
import {
  addLibraryDepartmentsAction, addLibraryRolesAction, deleteDepartmentAction, deleteRoleAction, firstRoleAction, saveDepartmentAction, saveRoleAction,
} from "@/lib/team-actions";
import { fill } from "@/lib/format";
import type { Key } from "@/lib/i18n";
import type { Doctor, Locale, Tenant } from "@/lib/types";
import { ConfirmDelete } from "./Confirm";
import { Fold } from "./Fold";
import { SubmitButton } from "./SubmitButton";
import { Badge, Empty, Notice } from "./ui";

export type TeamQuery = { done?: string; err?: string; n?: string; who?: string; rg?: string; rq?: string; dg?: string; dq?: string };
const DONE = ["added", "saved", "library", "first", "deleted", "dadded", "dsaved", "dlibrary", "ddeleted"];
const ERR = ["name", "same", "full", "none", "last", "in_use", "dname", "dsame", "dfull", "dnone", "confirm", "gone", "manager"];
const SHOW = 80; // library rows shown at once; search narrows the rest

/**
 * Roles and departments (2026-11-02): the client's own list of each (add, edit, delete, search), suggestions for its kind of
 * business from lib/team-library.ts, the whole library with a kind filter and search, and adding one's own name with
 * autocomplete. Used by the admin (client > Business > Roles and departments) and the client's manager (Bookings > Roles).
 */
export function TeamLibraryManager({ tenant, doctors, sp, t, locale, canEdit, admin }: {
  tenant: Tenant; doctors: Doctor[]; sp: TeamQuery; t: (k: Key) => string; locale: Locale; canEdit: boolean; admin?: boolean;
}) {
  const T = (k: string, v?: Record<string, string | number>) => (v ? fill(t(k as Key), v) : t(k as Key));
  const hidden = admin ? <input type="hidden" name="tenantId" value={tenant.id} /> : null;
  const roles = rolesOf(tenant);
  const departments = departmentsOf(tenant);
  const suggested = suggestedGroups(kindChoice(businessOf(tenant)));
  const groupName = (g: string) => (g === "general" ? T("teamlib.general") : T(`biz.kind.${g}`));
  const other = (en: string, ar: string) => (locale === "ar" ? en : ar);
  const mine = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const haveRole = (one: string, oneAr: string) => roles.some((r) => r.one.toLowerCase() === one.toLowerCase() || r.oneAr === oneAr);
  const haveDept = (en: string, ar: string) => departments.some((d) => d.en.toLowerCase() === en.toLowerCase() || d.ar === ar);
  const people = (key: string, kind: "role" | "dept") => doctors.filter((d) => (kind === "role" ? roleOf(roles, d.role).key === key : d.department === key));
  const rq = (sp.rq ?? "").trim(), dq = (sp.dq ?? "").trim();
  const rg = TEAM_LIBRARY.some((g) => g.key === sp.rg) ? sp.rg : "";
  const dg = TEAM_LIBRARY.some((g) => g.key === sp.dg) ? sp.dg : "";
  const roleRows = searchRoles(rq, rg || undefined);
  const deptRows = searchDepartments(dq, dg || undefined);
  const allRoles = searchRoles("");
  const allDepts = searchDepartments("");

  const groupSelect = (name: string, value: string) => (
    <label style={{ flex: "1 1 160px" }}>{T("teamlib.filter")}
      <select name={name} defaultValue={value}>
        <option value="">{T("teamlib.allKinds")}</option>
        {TEAM_LIBRARY.map((g) => <option key={g.key} value={g.key}>{groupName(g.key)}</option>)}
      </select>
    </label>
  );
  const roleTicks = (rows: { key: string; one: string; many: string; oneAr: string; manyAr: string; group?: string }[]) => (
    <div className="check-grid wide">
      {rows.slice(0, SHOW).map((r) => {
        const have = haveRole(r.one, r.oneAr);
        return (
          <label key={r.key} className="inline">
            <input type="checkbox" name="pick" value={r.key} disabled={have} />
            <span><span dir="auto">{mine(r.one, r.oneAr)}</span> <small className="muted" dir="auto">{other(r.one, r.oneAr)}{r.group && !rg ? ` · ${groupName(r.group)}` : ""}{have ? ` · ${T("teamlib.already")}` : ""}</small></span>
          </label>
        );
      })}
    </div>
  );
  const deptTicks = (rows: { key: string; en: string; ar: string; group?: string }[]) => (
    <div className="check-grid wide">
      {rows.slice(0, SHOW).map((d) => {
        const have = haveDept(d.en, d.ar);
        return (
          <label key={d.key} className="inline">
            <input type="checkbox" name="pick" value={d.key} disabled={have} />
            <span><span dir="auto">{mine(d.en, d.ar)}</span> <small className="muted" dir="auto">{other(d.en, d.ar)}{d.group && !dg ? ` · ${groupName(d.group)}` : ""}{have ? ` · ${T("teamlib.already")}` : ""}</small></span>
          </label>
        );
      })}
    </div>
  );
  const suggestion = (g: TeamLibraryGroup, what: "role" | "dept") => (
    <div key={g.key} className="stack" style={{ gap: ".4rem" }}>
      <strong>{groupName(g.key)}</strong>
      {what === "role" ? roleTicks(g.roles) : deptTicks(g.departments)}
    </div>
  );
  const roleFields = (r?: { one: string; many: string; oneAr: string; manyAr: string }) => (
    <div className="form-cols">
      <label>{T("biz.role.one")}<input name="one" list="teamlib-roles" defaultValue={r?.one} maxLength={40} dir="ltr" autoComplete="off" /></label>
      <label>{T("biz.role.many")}<input name="many" defaultValue={r?.many} maxLength={40} dir="ltr" /></label>
      <label>{T("biz.role.oneAr")}<input name="oneAr" list="teamlib-roles" defaultValue={r?.oneAr} maxLength={40} dir="rtl" autoComplete="off" /></label>
      <label>{T("biz.role.manyAr")}<input name="manyAr" defaultValue={r?.manyAr} maxLength={40} dir="rtl" /></label>
    </div>
  );
  const deptFields = (d?: { en: string; ar: string; about?: string }) => (
    <>
      <div className="form-cols">
        <label>{T("teamlib.dept.en")}<input name="en" list="teamlib-depts" defaultValue={d?.en} maxLength={60} dir="ltr" autoComplete="off" /></label>
        <label>{T("teamlib.dept.ar")}<input name="ar" list="teamlib-depts" defaultValue={d?.ar} maxLength={60} dir="rtl" autoComplete="off" /></label>
      </div>
      <label>{T("teamlib.dept.about")}<textarea name="about" rows={2} maxLength={300} defaultValue={d?.about} dir="auto" placeholder={T("teamlib.dept.about.ph")} /></label>
    </>
  );
  const members = (key?: string) => doctors.length > 0 && (
    <fieldset className="stack" style={{ margin: 0 }}>
      <legend className="muted">{T("teamlib.dept.members")}</legend>
      <input type="hidden" name="membersShown" value="1" />
      <div className="check-grid">
        {doctors.map((d) => {
          const elsewhere = d.department && d.department !== key ? departments.find((x) => x.key === d.department) : undefined;
          return (
            <label key={d.id} className="inline">
              <input type="checkbox" name="member" value={d.id} defaultChecked={Boolean(key) && d.department === key} />
              <span dir="auto">{d.name}{elsewhere ? <small className="muted"> · {departmentName(elsewhere, locale)}</small> : null}</span>
            </label>
          );
        })}
      </div>
      <small className="muted">{T("teamlib.dept.members.help")}</small>
    </fieldset>
  );

  return (
    <div className="stack">
      {sp.done && DONE.includes(sp.done) && <Notice tone="ok">{T(`teamlib.done.${sp.done}`, { n: Number(sp.n) || 0 })}</Notice>}
      {sp.err && ERR.includes(sp.err) && <Notice tone="warn">{T(`teamlib.err.${sp.err}`, { who: (sp.who ?? "").slice(0, 60) })}</Notice>}
      <datalist id="teamlib-roles">{allRoles.flatMap((r) => [<option key={`e${r.key}`} value={r.one}>{r.oneAr}</option>, <option key={`a${r.key}`} value={r.oneAr}>{r.one}</option>])}</datalist>
      <datalist id="teamlib-depts">{allDepts.flatMap((d) => [<option key={`e${d.key}`} value={d.en}>{d.ar}</option>, <option key={`a${d.key}`} value={d.ar}>{d.en}</option>])}</datalist>

      {/* ---------- roles ---------- */}
      <section className="card stack" id="roles">
        <h2 style={{ margin: 0 }}>{T("teamlib.roles", { n: roles.length })}</h2>
        <small className="muted">{T("teamlib.roles.help")}</small>
        <ul className="day-list">
          {roles.map((r, i) => {
            const who = people(r.key, "role");
            const summary = (
              <span className="who"><span dir="auto">{roleName(r, locale)}</span><small className="muted" dir="auto">{[other(r.one, r.oneAr), (who.length === 1 ? T("teamlib.person") : T("teamlib.people", { n: who.length }))].join(" · ")}</small></span>
            );
            return (
              <li key={r.key} id={`role-${r.key}`}>
                {canEdit ? (
                  <details className="svc">
                    <summary>{summary}{i === 0 && <Badge>{T("teamlib.main")}</Badge>}</summary>
                    <form action={saveRoleAction} className="stack">
                      {hidden}<input type="hidden" name="key" value={r.key} />
                      {roleFields(r)}
                      <div><SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton></div>
                    </form>
                    {who.length > 0 && <small className="muted" dir="auto">{who.map((d) => d.name).join(", ")}</small>}
                    {i > 0 && (
                      <form action={firstRoleAction}>
                        {hidden}<input type="hidden" name="key" value={r.key} />
                        <SubmitButton className="btn ghost small" type="submit">{T("teamlib.makeMain")}</SubmitButton>
                      </form>
                    )}
                    {roles.length > 1 && <ConfirmDelete action={deleteRoleAction} summary={t("common.delete")} warning={T("teamlib.role.delete.warning")} tick={T("teamlib.delete.tick")} button={t("common.delete")} fields={{ ...(admin ? { tenantId: tenant.id } : {}), key: r.key }} />}
                  </details>
                ) : <div className="svc-row">{summary}{i === 0 && <Badge>{T("teamlib.main")}</Badge>}</div>}
              </li>
            );
          })}
        </ul>
      </section>

      {canEdit && (
        <>
          <Fold id="roles-library" open={sp.err === "none" || Boolean(sp.rq || sp.rg)} title={T("teamlib.roles.suggest")} hint={T("teamlib.suggest.help")}>
            <form action={addLibraryRolesAction} className="stack">
              {hidden}
              {suggested.map((g) => suggestion(g, "role"))}
              <div><SubmitButton className="btn" type="submit">{T("teamlib.roles.addTicked")}</SubmitButton></div>
            </form>
            <hr />
            <strong>{T("teamlib.browse")}</strong>
            <form className="row" style={{ alignItems: "end", gap: ".5rem", flexWrap: "wrap" }} role="search" action="#roles-library">
              {groupSelect("rg", rg ?? "")}
              <label style={{ flex: "2 1 200px" }}>{T("teamlib.search")}<input name="rq" defaultValue={rq} list="teamlib-roles" placeholder={T("teamlib.search.roles.ph")} autoComplete="off" /></label>
              {sp.dg && <input type="hidden" name="dg" value={sp.dg} />}{sp.dq && <input type="hidden" name="dq" value={sp.dq} />}
              <SubmitButton className="btn ghost" type="submit">{t("common.search")}</SubmitButton>
            </form>
            {(rq || rg) ? (
              <form action={addLibraryRolesAction} className="stack">
                {hidden}
                <small className="muted">{T("teamlib.found", { n: roleRows.length })}{roleRows.length > SHOW ? ` ${T("teamlib.narrow", { n: SHOW })}` : ""}</small>
                {roleRows.length ? roleTicks(roleRows) : <p className="muted">{t("common.none")}</p>}
                {roleRows.length > 0 && <div><SubmitButton className="btn" type="submit">{T("teamlib.roles.addTicked")}</SubmitButton></div>}
              </form>
            ) : <small className="muted">{T("teamlib.browse.help", { n: allRoles.length })}</small>}
          </Fold>
          <Fold id="role-new" open={["name", "same", "full"].includes(sp.err ?? "")} title={T("teamlib.roles.own")} hint={T("teamlib.own.help")}>
            <form action={saveRoleAction} className="stack">
              {hidden}
              {roleFields()}
              <small className="muted">{T("teamlib.own.fill")}</small>
              <div><SubmitButton className="btn" type="submit">{T("teamlib.roles.add")}</SubmitButton></div>
            </form>
          </Fold>
        </>
      )}

      {/* ---------- departments ---------- */}
      <section className="card stack" id="departments">
        <h2 style={{ margin: 0 }}>{T("teamlib.depts", { n: departments.length })}</h2>
        <small className="muted">{T("teamlib.depts.help")}</small>
        {departments.length === 0 && <Empty kind="inbox">{T("teamlib.depts.none")}</Empty>}
        {departments.length > 0 && (
          <ul className="day-list">
            {departments.map((d) => {
              const who = people(d.key, "dept");
              const summary = (
                <span className="who"><span dir="auto">{departmentName(d, locale)}</span><small className="muted" dir="auto">{[other(d.en, d.ar), (who.length === 1 ? T("teamlib.person") : T("teamlib.people", { n: who.length }))].join(" · ")}</small></span>
              );
              return (
                <li key={d.key} id={`dept-${d.key}`}>
                  {canEdit ? (
                    <details className="svc">
                      <summary>{summary}</summary>
                      <form action={saveDepartmentAction} className="stack">
                        {hidden}<input type="hidden" name="key" value={d.key} />
                        {deptFields(d)}
                        {members(d.key)}
                        <div><SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton></div>
                      </form>
                      <ConfirmDelete action={deleteDepartmentAction} summary={t("common.delete")} warning={T("teamlib.dept.delete.warning")} tick={T("teamlib.delete.tick")} button={t("common.delete")} fields={{ ...(admin ? { tenantId: tenant.id } : {}), key: d.key }} />
                    </details>
                  ) : <div className="svc-row">{summary}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canEdit && (
        <>
          <Fold id="departments-library" open={sp.err === "dnone" || Boolean(sp.dq || sp.dg) || departments.length === 0} title={T("teamlib.depts.suggest")} hint={T("teamlib.suggest.help")}>
            <form action={addLibraryDepartmentsAction} className="stack">
              {hidden}
              {suggested.map((g) => suggestion(g, "dept"))}
              <div><SubmitButton className="btn" type="submit">{T("teamlib.depts.addTicked")}</SubmitButton></div>
            </form>
            <hr />
            <strong>{T("teamlib.browse")}</strong>
            <form className="row" style={{ alignItems: "end", gap: ".5rem", flexWrap: "wrap" }} role="search" action="#departments-library">
              {groupSelect("dg", dg ?? "")}
              <label style={{ flex: "2 1 200px" }}>{T("teamlib.search")}<input name="dq" defaultValue={dq} list="teamlib-depts" placeholder={T("teamlib.search.depts.ph")} autoComplete="off" /></label>
              {sp.rg && <input type="hidden" name="rg" value={sp.rg} />}{sp.rq && <input type="hidden" name="rq" value={sp.rq} />}
              <SubmitButton className="btn ghost" type="submit">{t("common.search")}</SubmitButton>
            </form>
            {(dq || dg) ? (
              <form action={addLibraryDepartmentsAction} className="stack">
                {hidden}
                <small className="muted">{T("teamlib.found", { n: deptRows.length })}{deptRows.length > SHOW ? ` ${T("teamlib.narrow", { n: SHOW })}` : ""}</small>
                {deptRows.length ? deptTicks(deptRows) : <p className="muted">{t("common.none")}</p>}
                {deptRows.length > 0 && <div><SubmitButton className="btn" type="submit">{T("teamlib.depts.addTicked")}</SubmitButton></div>}
              </form>
            ) : <small className="muted">{T("teamlib.browse.help", { n: allDepts.length })}</small>}
          </Fold>
          <Fold id="dept-new" open={["dname", "dsame", "dfull"].includes(sp.err ?? "")} title={T("teamlib.depts.own")} hint={T("teamlib.own.help")}>
            <form action={saveDepartmentAction} className="stack">
              {hidden}
              {deptFields()}
              {members()}
              <small className="muted">{T("teamlib.own.fill")}</small>
              <div><SubmitButton className="btn" type="submit">{T("teamlib.depts.add")}</SubmitButton></div>
            </form>
          </Fold>
          <small className="muted">{T("teamlib.fields")}</small>
        </>
      )}
    </div>
  );
}
