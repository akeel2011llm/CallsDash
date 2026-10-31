import type { ReactNode } from "react";
import { idRuleOf } from "@/lib/id-rule";
import { dictionaries, type Key } from "@/lib/i18n";
import { fill, fmtDate } from "@/lib/format";
import { foldText } from "@/lib/items";
import { phoneKey } from "@/lib/customers";
import { LARGE_PHOTO_BYTES, FREE_DB_BYTES, fmtBytes, usageShare, usageTotals } from "@/lib/data-hub";
import { dataBulkAction, dataImportAction, dataPhotoAction, dataRowAction } from "@/lib/data-actions";
import { getCustomers, getDoctors, getItems, getKnowledge, getPhotoUsage, databaseSize } from "@/lib/data";
import type { Customer, Item, KnowledgeItem, Locale, Tenant } from "@/lib/types";
import { Badge, Empty, Notice } from "./ui";
import { Fold } from "./Fold";
import { FoldControls } from "./FoldControls";
import { SubmitButton } from "./SubmitButton";
import { ItemFields } from "./ItemFields";
import { CustomerFields } from "./CustomerFields";
import { ItemPhotoInput } from "./ItemPhotoInput";
import { SelectAll } from "./SelectAll";
import { Guide } from "./Guide";
import { extraFieldsOf } from "@/lib/extra-fields";

export interface DataSearch {
  q?: string; open?: string; photo?: string; saved?: string; bulk?: string; err?: string; col?: string; pl?: string;
  imp?: string; added?: string; updated?: string; skipped?: string; more?: string; errs?: string;
}

const SHOWN = 100;
const SECTION_OF = (open: string) => (open.startsWith("item-") || open.startsWith("doctor-") ? "photos" : open.split("-")[0]);

/**
 * The Data screen: photos, catalogue, customers, knowledge, storage, import and export, in folded sections. The admin has it for any
 * client (`scope="admin"`); a clinic manager has it for their own client once the admin switched it on. Edits go through lib/data-actions.ts.
 */
export async function DataView({ tenant, scope, sp, t, locale, base }: {
  tenant: Tenant; scope: "admin" | "client"; sp: DataSearch; t: (k: Key) => string; locale: Locale; base: string;
}) {
  const admin = scope === "admin";
  const knowledgeLocked = !admin && !tenant.permissions.editKnowledge;
  const [items, customers, knowledge, doctors, usage, dbBytes] = await Promise.all([
    getItems(tenant.id), getCustomers(tenant.id), getKnowledge(tenant.id), getDoctors(tenant.id), getPhotoUsage(tenant.id), admin ? databaseSize() : Promise.resolve(undefined),
  ]);
  const tq = admin ? `&t=${encodeURIComponent(tenant.id)}` : "";
  const hidden = <><input type="hidden" name="scope" value={scope} /><input type="hidden" name="tenantId" value={tenant.id} /></>;
  const q = foldText((sp.q ?? "").trim());
  const open = sp.open && /^[a-z]+(-[\w-]*)?$/.test(sp.open) ? sp.open : "";
  const openSection = open ? SECTION_OF(open) : sp.photo ? "photos" : sp.imp || ["nofile", "toobig", "column", "badfile"].includes(sp.err ?? "") ? "transfer" : "";
  const err = sp.err && /^[a-z_]+$/.test(sp.err) ? sp.err : "";
  const errText = (code: string, vars: Record<string, string> = {}) => {
    const key = `data.err.${code}`;
    return fill(t((key in dictionaries.en ? key : "data.err.other") as Key), vars);
  };

  const bytesOf = new Map(usage.map((u) => [`${u.kind}:${u.id}`, u.bytes]));
  const totals = usageTotals(usage);
  const largeOnly = sp.pl === "1";
  const photoRows = [
    ...items.map((i) => ({ kind: "item" as const, id: i.id, name: i.name, hidden: !i.active, has: i.hasImage, v: Date.parse(i.updatedAt) || 0 })),
    ...doctors.map((d) => ({ kind: "doctor" as const, id: d.id, name: d.name, hidden: d.active === false, has: Boolean(d.photoAt), v: Date.parse(d.photoAt ?? "") || 0 })),
  ].map((r) => ({ ...r, bytes: bytesOf.get(`${r.kind}:${r.id}`) ?? 0 }))
    .filter((r) => !largeOnly || r.bytes > LARGE_PHOTO_BYTES)
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));

  const itemRows = q ? items.filter((i) => foldText(`${i.name} ${i.nameAr ?? ""} ${i.keywords} ${i.details}`).includes(q)) : items;
  const digits = q.replace(/\D/g, "");
  const custRows = q ? customers.filter((c) => foldText(`${c.name} ${c.email ?? ""}`).includes(q) || (digits.length >= 3 && c.phone.replace(/\D/g, "").includes(digits)) || (phoneKey(q) && phoneKey(c.phone) === phoneKey(q))) : customers;
  const knowRows = q ? knowledge.filter((k) => foldText(`${k.question} ${k.answer}`).includes(q)) : knowledge;

  const bulk = (kind: "catalogue" | "customers" | "knowledge", ops: ("hide" | "show" | "delete")[], disabled: boolean) => (
    <form id={`bulk-${kind}`} action={dataBulkAction} className="stack bulk-bar">
      {hidden}<input type="hidden" name="kind" value={kind} />
      <fieldset disabled={disabled} className="row" style={{ border: 0, padding: 0, margin: 0 }}>
        {ops.filter((o) => o !== "delete").map((o) => <SubmitButton key={o} className="btn small ghost" name="op" value={o}>{t(`data.bulk.${o}` as Key)}</SubmitButton>)}
        {ops.includes("delete") && (
          <>
            <label className="inline"><input type="checkbox" name="confirm" />{t("data.bulk.confirm")}</label>
            <SubmitButton className="btn small danger" name="op" value="delete">{t("data.bulk.delete")}</SubmitButton>
          </>
        )}
      </fieldset>
    </form>
  );

  const rowShell = (kind: "catalogue" | "customers" | "knowledge", id: string, head: ReactNode, form: ReactNode, disabled: boolean) => (
    <article key={id} className="data-row">
      <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
        <input type="checkbox" name="ids" value={id} form={`bulk-${kind}`} aria-label={t("data.rows.selectAll")} disabled={disabled} />
        <div style={{ flex: 1, minInlineSize: 0 }}>{head}</div>
      </div>
      <details open={open === `${kind}-${id}`}>
        <summary className="muted" style={{ cursor: "pointer" }}>{t("data.rows.edit")}</summary>
        <form action={dataRowAction} className="stack" style={{ marginBlockStart: ".5rem" }}>
          {hidden}<input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} />
          <fieldset disabled={disabled} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            {form}
            <div><SubmitButton className="btn small" type="submit">{t("common.save")}</SubmitButton></div>
          </fieldset>
        </form>
      </details>
    </article>
  );

  const listFoot = (shown: number, total: number) => <small className="muted">{fill(t("data.rows.count"), { n: shown, total })}</small>;
  const itemPhoto = (i: Pick<Item, "id" | "updatedAt">) => `/api/data/photo/item/${i.id}?v=${Date.parse(i.updatedAt) || 0}${tq}`;

  return (
    <>
      <Guide id="data">
        <ol className="stack">{(["1", "2", "3", "4"] as const).map((n) => <li key={n}>{t(`data.guide.${n}` as Key)}</li>)}</ol>
      </Guide>

      {sp.photo === "saved" && <Notice tone="ok">{t("data.n.photoSaved")}</Notice>}
      {sp.photo === "removed" && <Notice tone="ok">{t("data.n.photoRemoved")}</Notice>}
      {sp.saved && <Notice tone="ok">{t("data.n.saved")}</Notice>}
      {sp.bulk && /^\d+$/.test(sp.bulk) && <Notice tone="ok">{fill(t("data.n.bulk"), { n: sp.bulk })}</Notice>}
      {err && <Notice tone="warn">{errText(err, { col: (sp.col ?? "").replace(/[^a-z]/g, "") })}</Notice>}
      {sp.imp && (
        <Notice tone={Number(sp.skipped) > 0 ? "warn" : "ok"}>
          <div className="stack" style={{ gap: ".25rem" }}>
            <span>{fill(t("data.n.imported"), { kind: t(`data.import.${["catalogue", "customers", "knowledge"].includes(sp.imp) ? sp.imp : "catalogue"}` as Key), added: Number(sp.added) || 0, updated: Number(sp.updated) || 0, skipped: Number(sp.skipped) || 0 })}</span>
            {sp.more === "1" && <span>{t("data.n.more")}</span>}
            {(sp.errs ?? "").split(",").filter((e) => /^\d+\.[a-z_]+$/.test(e)).map((e) => {
              const [line, code] = e.split(".");
              return <span key={e}>{fill(t("data.n.line"), { line, reason: errText(code) })}</span>;
            })}
          </div>
        </Notice>
      )}

      <form method="get" className="row" style={{ flexWrap: "nowrap" }} role="search">
        <input name="q" defaultValue={sp.q ?? ""} placeholder={t("data.search")} aria-label={t("data.search")} maxLength={80} style={{ flex: 1 }} />
        <SubmitButton className="btn" type="submit">{t("common.search")}</SubmitButton>
      </form>

      <FoldControls openAll={t("fold.openAll")} closeAll={t("fold.closeAll")} />

      <Fold id="storage" title={t("data.storage.title")} hint={fill(t("data.storage.hint"), { n: totals.count, size: fmtBytes(totals.total) })} open={openSection === "storage"}>
        {admin && (dbBytes !== undefined ? (
          <div className="stack" style={{ gap: ".35rem" }}>
            <strong>{fill(t("data.storage.db"), { used: fmtBytes(dbBytes), limit: fmtBytes(FREE_DB_BYTES) })}</strong>
            <meter min={0} max={1} low={0.7} high={0.85} optimum={0} value={Math.min(1, usageShare(dbBytes))} style={{ inlineSize: "100%" }} aria-label={t("data.storage.title")} />
            <small className="muted">{t("data.storage.dbNote")}</small>
          </div>
        ) : <small className="muted">{t("data.storage.dbDemo")}</small>)}
        <span>{fill(t("data.storage.photos"), { n: totals.count, size: fmtBytes(totals.total) })}</span>
        <span>{totals.large ? fill(t("data.storage.large"), { n: totals.large }) : t("data.storage.fine")}</span>
        <small className="muted">{fill(t("data.storage.counts"), { items: items.length, customers: customers.length, knowledge: knowledge.length, doctors: doctors.length })}</small>
      </Fold>

      <Fold id="photos" title={t("data.photos.title")} hint={t("data.photos.hint")} badge={totals.large ? <Badge tone="warn">{totals.large} {t("data.photos.large")}</Badge> : undefined} open={openSection === "photos"}>
        <div className="row">
          <a className="btn small ghost" href={`${base}?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(largeOnly ? {} : { pl: "1" }) })}#photos`}>{largeOnly ? t("data.photos.showAll") : t("data.photos.onlyLarge")}</a>
          <small className="muted">{t("data.photos.help")}</small>
        </div>
        {photoRows.length === 0 ? <Empty kind="inbox">{t("data.photos.none")}</Empty> : photoRows.slice(0, SHOWN).map((r) => (
          <article key={`${r.kind}-${r.id}`} className="data-row">
            <div className="row" style={{ flexWrap: "nowrap", alignItems: "center" }}>
              {r.has
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={`/api/data/photo/${r.kind}/${r.id}?v=${r.v}${tq}`} alt="" width={56} height={56} loading="lazy" style={{ objectFit: "cover", borderRadius: 8, flex: "none" }} />
                : <span className="muted" style={{ inlineSize: 56, textAlign: "center", flex: "none" }}>-</span>}
              <div style={{ flex: 1, minInlineSize: 0 }}>
                <strong dir="auto">{r.name}</strong>
                <div className="row" style={{ gap: ".35rem" }}>
                  <Badge>{t(r.kind === "item" ? "data.photos.item" : "data.photos.doctor")}</Badge>
                  {r.hidden && <Badge>{t("data.photos.hidden")}</Badge>}
                  {r.has ? <small className="muted">{fmtBytes(r.bytes)}</small> : <small className="muted">{t("data.photos.noPhoto")}</small>}
                  {r.bytes > LARGE_PHOTO_BYTES && <Badge tone="warn">{t("data.photos.large")}</Badge>}
                </div>
              </div>
            </div>
            <details open={open === `${r.kind}-${r.id}`}>
              <summary className="muted" style={{ cursor: "pointer" }}>{t(r.has ? "data.photos.replace" : "data.photos.add")}</summary>
              <form action={dataPhotoAction} className="stack" style={{ marginBlockStart: ".5rem" }}>
                {hidden}<input type="hidden" name="kind" value={r.kind} /><input type="hidden" name="id" value={r.id} />
                <ItemPhotoInput name="photo" label={t("data.photos.add")} working={t("data.photos.working")} failed={t("data.photos.failed")} />
                <div className="row"><SubmitButton className="btn small" type="submit">{t("data.photos.save")}</SubmitButton></div>
              </form>
              {r.has && (
                <form action={dataPhotoAction} className="row" style={{ marginBlockStart: ".5rem" }}>
                  {hidden}<input type="hidden" name="kind" value={r.kind} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="remove" value="on" />
                  <SubmitButton className="btn small danger" type="submit">{t("data.photos.remove")}</SubmitButton>
                </form>
              )}
            </details>
          </article>
        ))}
        {photoRows.length > 0 && <small className="muted">{fill(t("data.photos.count"), { n: Math.min(SHOWN, photoRows.length), total: photoRows.length })}</small>}
      </Fold>

      <Fold id="catalogue" title={t("data.cat.title")} hint={t("data.cat.hint")} badge={<Badge>{items.length}</Badge>} open={openSection === "catalogue" || Boolean(q && itemRows.length)}>
        <details open={open === "catalogue-"}>
          <summary><strong>{t("data.cat.add")}</strong></summary>
          <form action={dataRowAction} className="stack" style={{ marginBlockStart: ".75rem" }}>
            {hidden}<input type="hidden" name="kind" value="catalogue" />
            <fieldset disabled={knowledgeLocked} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <ItemFields t={t as unknown as (k: never) => string} />
              <div><SubmitButton className="btn" type="submit">{t("data.rows.add")}</SubmitButton></div>
            </fieldset>
          </form>
        </details>
        {bulk("catalogue", ["hide", "show", "delete"], knowledgeLocked)}
        {itemRows.length === 0 ? <Empty kind="inbox">{q ? t("data.rows.noMatch") : t("data.rows.none")}</Empty> : (
          <>
            <SelectAll form="bulk-catalogue" label={t("data.rows.selectAll")} />
            {itemRows.slice(0, SHOWN).map((i) => rowShell("catalogue", i.id, (
              <div className="row" style={{ flexWrap: "nowrap", alignItems: "center" }}>
                {i.hasImage
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={itemPhoto(i)} alt="" width={40} height={40} loading="lazy" style={{ objectFit: "cover", borderRadius: 6, flex: "none" }} /> : null}
                <span><strong dir="auto">{i.name}</strong>{i.nameAr && <><br /><small className="muted" dir="rtl">{i.nameAr}</small></>}</span>
                {!i.active && <Badge>{t("data.photos.hidden")}</Badge>}
                {i.price && <small className="muted" dir="auto">{i.price}</small>}
              </div>
            ), <ItemFields t={t as unknown as (k: never) => string} item={i} photoSrc={itemPhoto(i)} />, knowledgeLocked))}
          </>
        )}
        {listFoot(Math.min(SHOWN, itemRows.length), itemRows.length)}
      </Fold>

      <Fold id="customers" title={t("data.cust.title")} hint={t("data.cust.hint")} badge={<Badge>{customers.length}</Badge>} open={openSection === "customers" || Boolean(q && custRows.length)}>
        <details open={open === "customers-"}>
          <summary><strong>{t("data.cust.add")}</strong></summary>
          <form action={dataRowAction} className="stack" style={{ marginBlockStart: ".75rem" }}>
            {hidden}<input type="hidden" name="kind" value="customers" />
            <CustomerFields t={t as unknown as (k: never) => string} id={idRuleOf(tenant)} fields={extraFieldsOf(tenant, "customer")} locale={locale} />
            <div><SubmitButton className="btn" type="submit">{t("data.rows.add")}</SubmitButton></div>
          </form>
        </details>
        {bulk("customers", ["delete"], false)}
        {custRows.length === 0 ? <Empty kind="inbox">{q ? t("data.rows.noMatch") : t("data.rows.none")}</Empty> : (
          <>
            <SelectAll form="bulk-customers" label={t("data.rows.selectAll")} />
            {custRows.slice(0, SHOWN).map((c: Customer) => rowShell("customers", c.id, (
              <span><strong dir="auto">{c.name || "-"}</strong> <small className="muted" dir="ltr">{c.phone}</small>{c.lastContactAt && <small className="muted"> · {fmtDate(c.lastContactAt, locale)}</small>}</span>
            ), <CustomerFields t={t as unknown as (k: never) => string} c={c} id={idRuleOf(tenant)} fields={extraFieldsOf(tenant, "customer")} locale={locale} />, false))}
          </>
        )}
        {listFoot(Math.min(SHOWN, custRows.length), custRows.length)}
      </Fold>

      <Fold id="knowledge" title={t("data.know.title")} hint={t("data.know.hint")} badge={<Badge>{knowledge.length}</Badge>} open={openSection === "knowledge" || Boolean(q && knowRows.length)}>
        <details open={open === "knowledge-"}>
          <summary><strong>{t("data.know.add")}</strong></summary>
          <form action={dataRowAction} className="stack" style={{ marginBlockStart: ".75rem" }}>
            {hidden}<input type="hidden" name="kind" value="knowledge" />
            <fieldset disabled={knowledgeLocked} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <KnowledgeFields t={t} />
              <div><SubmitButton className="btn" type="submit">{t("data.rows.add")}</SubmitButton></div>
            </fieldset>
          </form>
        </details>
        {bulk("knowledge", ["delete"], knowledgeLocked)}
        {knowRows.length === 0 ? <Empty kind="inbox">{q ? t("data.rows.noMatch") : t("data.rows.none")}</Empty> : (
          <>
            <SelectAll form="bulk-knowledge" label={t("data.rows.selectAll")} />
            {knowRows.slice(0, SHOWN).map((k: KnowledgeItem) => rowShell("knowledge", k.id, (
              <div dir={k.language === "ar" ? "rtl" : "ltr"}><strong>{k.question}</strong><div className="muted clamp-2">{k.answer}</div></div>
            ), <KnowledgeFields t={t} k={k} />, knowledgeLocked))}
          </>
        )}
        {listFoot(Math.min(SHOWN, knowRows.length), knowRows.length)}
      </Fold>

      <Fold id="transfer" title={t("data.transfer.title")} hint={t("data.transfer.hint")} open={openSection === "transfer"}>
        <h3>{t("data.export.title")}</h3>
        <div className="stack" style={{ gap: ".4rem" }}>
          {(["catalogue", "customers", "knowledge", "doctors"] as const).map((k) => (
            <div key={k} className="row">
              <strong style={{ minInlineSize: "7rem" }}>{t(`data.export.${k}` as Key)}</strong>
              <a className="btn small ghost" href={`/api/data/export/${k}${tq ? `?${tq.slice(1)}` : ""}`} aria-label={`${t(`data.export.${k}` as Key)}: ${t("sheet.csv")}`}>{t("sheet.csv")}</a>
              <a className="btn small ghost" href={`/api/data/export/${k}?format=xlsx${tq}`} aria-label={`${t(`data.export.${k}` as Key)}: ${t("sheet.xlsx")}`}>{t("sheet.xlsx")}</a>
            </div>
          ))}
        </div>
        <div className="row">
          <a className="btn small ghost" href={`/api/data/export/all${tq ? `?${tq.slice(1)}` : ""}`}>{t("data.export.all")}</a>
          <a className="btn small ghost" href={`/api/data/export/all?photos=1${tq}`}>{t("data.export.allPhotos")}</a>
        </div>
        <small className="muted">{t("data.export.note")}</small>
        <h3>{t("data.import.title")}</h3>
        <small className="muted">{t("data.import.help")}</small>
        {(["catalogue", "customers", "knowledge"] as const).map((k) => (
          <form key={k} action={dataImportAction} className="row import-row" encType="multipart/form-data">
            {hidden}<input type="hidden" name="kind" value={k} />
            <fieldset disabled={k !== "customers" && knowledgeLocked} className="row" style={{ border: 0, padding: 0, margin: 0 }}>
              <strong style={{ minInlineSize: "7rem" }}>{t(`data.import.${k}` as Key)}</strong>
              <input type="file" name="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label={`${t(`data.import.${k}` as Key)}: ${t("data.import.file")}`} />
              <SubmitButton className="btn small" type="submit">{t("data.import.go")}</SubmitButton>
              <a className="btn small ghost" href={`/api/data/export/${k}?template=1${tq}`}>{t("data.import.template")} ({t("sheet.csv")})</a>
              <a className="btn small ghost" href={`/api/data/export/${k}?template=1&format=xlsx${tq}`}>{t("data.import.template")} ({t("sheet.xlsx")})</a>
            </fieldset>
          </form>
        ))}
        <small className="muted">{t("data.import.photosNote")}</small>
      </Fold>
    </>
  );
}

function KnowledgeFields({ t, k }: { t: (key: Key) => string; k?: KnowledgeItem }) {
  return (
    <>
      <label>{t("knowledge.question")}<input name="question" required maxLength={500} defaultValue={k?.question ?? ""} /></label>
      <label>{t("knowledge.answer")}<textarea name="answer" required maxLength={2000} rows={4} defaultValue={k?.answer ?? ""} /></label>
      <label>{t("common.language")}
        <select name="language" defaultValue={k?.language ?? "en"}><option value="en">English</option><option value="ar">العربية</option></select>
      </label>
    </>
  );
}
