import Link from "next/link";
import { SERVICE_LIBRARY, libraryType } from "@/lib/service-library";
import { SERVICE_LIMITS, serviceName, type Service } from "@/lib/services";
import { addLibraryServicesAction, deleteServiceAction, saveServiceAction, toggleServiceAction } from "@/lib/service-actions";
import { fill } from "@/lib/format";
import type { Key } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import { ConfirmDelete } from "./Confirm";
import { Fold } from "./Fold";
import { SubmitButton } from "./SubmitButton";
import { Badge, Empty, Notice } from "./ui";

export type ServicesQuery = { done?: string; err?: string; lib?: string; n?: string; q?: string };
const DONE = ["added", "saved", "library", "hidden", "shown", "deleted"];
const ERR = ["name", "minutes", "full", "same", "type", "none", "confirm", "gone", "manager"];

/**
 * The client's services: search, edit, hide or delete each one, add from the library (20 business types x 15 services,
 * English and Arabic) or add one's own. Used by the admin (client > Business > Services) and the client's manager
 * (Bookings > Services). `canEdit` false shows the list only.
 */
export function ServicesManager({ tenantId, list, sp, t, locale, canEdit, kind }: {
  tenantId?: string; list: Service[]; sp: ServicesQuery; t: (k: Key) => string; locale: Locale; canEdit: boolean;
  /** The client's kind of business (Business tab). The library shows its list first, until another kind is picked. */
  kind?: string;
}) {
  const T = (k: string, v?: Record<string, string | number>) => (v ? fill(t(k as Key), v) : t(k as Key));
  const hidden = tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null;
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = q ? list.filter((s) => `${s.name} ${s.nameAr}`.toLowerCase().includes(q)) : list;
  const lib = libraryType(sp.lib ?? kind ?? "");
  const fields = (s?: Service) => (
    <>
      <div className="grid two" style={{ gap: ".6rem" }}>
        <label>{T("services.f.name")}<input name="name" required maxLength={SERVICE_LIMITS.name} defaultValue={s?.name} dir="ltr" /></label>
        <label>{T("services.f.nameAr")}<input name="nameAr" maxLength={SERVICE_LIMITS.name} defaultValue={s?.nameAr} dir="rtl" /></label>
        <label>{T("services.f.minutes")}<input name="minutes" type="number" required min={5} max={600} step={5} defaultValue={s?.minutes ?? 30} /></label>
        <label>{T("services.f.price")}<input name="price" maxLength={SERVICE_LIMITS.price} defaultValue={s?.price} placeholder={T("services.h.price")} dir="auto" /></label>
      </div>
    </>
  );
  return (
    <div className="stack">
      {sp.done && DONE.includes(sp.done) && <Notice tone="ok">{T(`services.done.${sp.done}`, { n: Number(sp.n) || 0 })}</Notice>}
      {sp.err && ERR.includes(sp.err) && <Notice tone="warn">{T(`services.err.${sp.err}`)}</Notice>}

      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between", gap: ".5rem", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>{T("services.list", { n: list.length })}</h2>
          {list.length > 6 && (
            <form className="row" style={{ flexWrap: "nowrap" }} role="search">
              <input name="q" defaultValue={sp.q ?? ""} placeholder={T("services.search")} aria-label={T("services.search")} style={{ minInlineSize: 0 }} />
              <SubmitButton className="btn ghost" type="submit">{t("common.search")}</SubmitButton>
            </form>
          )}
        </div>
        {list.length === 0 && <Empty kind="inbox">{T("services.none")}</Empty>}
        {list.length > 0 && rows.length === 0 && <p className="muted">{t("common.none")}</p>}
        {rows.length > 0 && (
          <ul className="day-list">
            {rows.map((s) => (
              <li key={s.id} id={`s-${s.id}`}>
                {canEdit ? (
                  <details className="svc">
                    <summary>
                      <span className="who"><span dir="auto">{serviceName(s, locale)}</span><small className="muted" dir="auto">{[locale === "ar" ? s.name : s.nameAr, T("services.minutes", { n: s.minutes }), s.price].filter(Boolean).join(" · ")}</small></span>
                      {!s.active && <Badge>{T("services.hiddenBadge")}</Badge>}
                    </summary>
                    <form action={saveServiceAction} className="stack">
                      {hidden}<input type="hidden" name="id" value={s.id} />
                      {fields(s)}
                      <div className="row" style={{ gap: ".5rem", flexWrap: "wrap" }}>
                        <SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton>
                      </div>
                    </form>
                    <form action={toggleServiceAction}>
                      {hidden}<input type="hidden" name="id" value={s.id} />
                      <SubmitButton className="btn ghost small" type="submit">{T(s.active ? "services.hide" : "services.show")}</SubmitButton>
                    </form>
                    <ConfirmDelete action={deleteServiceAction} summary={t("common.delete")} warning={T("services.delete.warning")} tick={T("services.delete.tick")} button={t("common.delete")} fields={{ ...(tenantId ? { tenantId } : {}), id: s.id }} />
                  </details>
                ) : (
                  <div className="svc-row">
                    <span className="who"><span dir="auto">{serviceName(s, locale)}</span><small className="muted" dir="auto">{[T("services.minutes", { n: s.minutes }), s.price].filter(Boolean).join(" · ")}</small></span>
                    {!s.active && <Badge>{T("services.hiddenBadge")}</Badge>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <small className="muted">{T("services.usedFor")}</small>
      </section>

      {canEdit && (
        <Fold id="library" open={Boolean(lib) || sp.err === "none"} title={T("services.library")} hint={T("services.library.help")}>
          <div className="row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
            {SERVICE_LIBRARY.map((x) => <Link key={x.key} className={`btn small${x.key === lib?.key ? "" : " ghost"}`} href={`?lib=${x.key}#library`}>{locale === "ar" ? x.ar : x.en}</Link>)}
          </div>
          {lib ? (
            <form action={addLibraryServicesAction} className="stack">
              {hidden}<input type="hidden" name="type" value={lib.key} />
              <strong>{locale === "ar" ? lib.ar : lib.en}</strong>
              <div className="check-grid wide">
                {lib.services.map((s) => {
                  const have = list.some((x) => x.from === s.key || x.name.toLowerCase() === s.en.toLowerCase());
                  return (
                    <label key={s.key} className="inline">
                      <input type="checkbox" name="pick" value={s.key} defaultChecked={!have} disabled={have} />
                      <span><span dir="auto">{locale === "ar" ? s.ar : s.en}</span> <small className="muted">{locale === "ar" ? s.en : s.ar} · {T("services.minutes", { n: s.minutes })}{have ? ` · ${T("services.already")}` : ""}</small></span>
                    </label>
                  );
                })}
              </div>
              <small className="muted">{T("services.library.after")}</small>
              <div><SubmitButton className="btn" type="submit">{T("services.library.add")}</SubmitButton></div>
            </form>
          ) : <small className="muted">{T("services.library.pick")}</small>}
        </Fold>
      )}

      {canEdit && (
        <Fold id="new" open={["name", "minutes", "same", "full"].includes(sp.err ?? "")} title={T("services.add")} hint={T("services.add.help")}>
          <form action={saveServiceAction} className="stack">
            {hidden}
            {fields()}
            <div><SubmitButton className="btn" type="submit" disabled={list.length >= SERVICE_LIMITS.count}>{T("services.add.button")}</SubmitButton></div>
          </form>
        </Fold>
      )}
    </div>
  );
}
