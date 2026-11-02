import { SECTIONS, type AccessRules, type Section } from "@/lib/access";
import { saveAccessAction } from "@/lib/access-actions";
import type { Key } from "@/lib/i18n";
import type { Profile } from "@/lib/types";
import { Fold } from "./Fold";
import { SubmitButton } from "./SubmitButton";
import { Badge, Notice } from "./ui";

/** The menu name of each portal section. */
export const SECTION_LABEL: Record<Section, Key> = {
  inbox: "nav.inbox", bookings: "nav.bookings", customers: "nav.customers", catalog: "nav.catalog",
  assistant: "nav.yourAssistant", reports: "nav.reports", billing: "credits.title",
};

/**
 * "What team members can open": ticks for the receptionist default, and for each receptionist their own list. Managers
 * always see everything. Used on the admin client People tab and on the client manager's Team page.
 */
export function AccessEditor({ tenantId, rules, people, t, saved }: {
  tenantId?: string; rules: AccessRules; people: Pick<Profile, "id" | "fullName" | "email" | "role">[];
  t: (k: Key) => string; saved?: boolean;
}) {
  const reception = people.filter((p) => p.role === "receptionist");
  const base = rules.receptionist ?? [...SECTIONS];
  const boxes = (list: Section[]) => (
    <div className="check-grid">
      {SECTIONS.map((s) => <label key={s} className="inline"><input type="checkbox" name={`s_${s}`} defaultChecked={list.includes(s)} />{t(SECTION_LABEL[s])}</label>)}
    </div>
  );
  const hidden = (who: string) => <>{tenantId && <input type="hidden" name="tenantId" value={tenantId} />}<input type="hidden" name="who" value={who} /></>;
  const summary = (list: Section[]) => list.length === SECTIONS.length ? t("access.all") : list.length === 0 ? t("access.none") : list.map((s) => t(SECTION_LABEL[s])).join(", ");
  return (
    <Fold id="access" open={saved} title={t("access.title")} hint={t("access.help")}>
      {saved && <Notice tone="ok">{t("access.saved")}</Notice>}
      <p className="muted" style={{ margin: 0 }}>{t("access.always")}</p>
      <form action={saveAccessAction} className="stack">
        {hidden("receptionist")}
        <strong>{t("access.default")}</strong>
        {boxes(base)}
        <div><SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton></div>
      </form>
      {reception.length > 0 && <strong>{t("access.people")}</strong>}
      {reception.map((p) => {
        const own = rules.people?.[p.id];
        return (
          <details key={p.id} id={`access-${p.id}`} className="access-person">
            <summary>
              <span dir="auto">{p.fullName || p.email}</span>{" "}
              <Badge tone={own ? "info" : "neutral"}>{own ? t("access.own") : t("access.usesDefault")}</Badge>
              <small className="muted" style={{ display: "block" }}>{summary(own ?? base)}</small>
            </summary>
            <form action={saveAccessAction} className="stack">
              {hidden(p.id)}
              {boxes(own ?? base)}
              <div className="row" style={{ gap: ".5rem", flexWrap: "wrap" }}>
                <SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton>
                {own && <SubmitButton className="btn ghost" type="submit" name="reset" value="1">{t("access.reset")}</SubmitButton>}
              </div>
            </form>
          </details>
        );
      })}
    </Fold>
  );
}
