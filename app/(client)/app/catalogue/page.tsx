import Link from "next/link";
import { requireClient } from "@/lib/auth";
import { dictionaries, getT } from "@/lib/i18n";
import { getItems } from "@/lib/data";
import { foldText } from "@/lib/items";
import { saveItemAction } from "@/lib/item-actions";
import { Badge, Empty, Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { ItemFields } from "@/components/ItemFields";
import { Guide } from "@/components/Guide";
import { itemPhotoPath } from "@/lib/item-photo";

const SHOWN = 200;

export default async function CataloguePage({ searchParams }: { searchParams: Promise<{ q?: string; deleted?: string; err?: string }> }) {
  const { tenant } = await requireClient();
  const sp = await searchParams;
  const [{ t }, all] = await Promise.all([getT(), getItems(tenant.id)]);
  const locked = !tenant.permissions.editKnowledge;
  const q = foldText((sp.q ?? "").trim());
  const found = q ? all.filter((i) => foldText(`${i.name} ${i.nameAr ?? ""} ${i.keywords} ${i.details}`).includes(q)) : all;
  const rows = found.slice(0, SHOWN);
  const err = sp.err && /^[a-z_]+$/.test(sp.err) ? `catalogue.err.${sp.err}` : "";
  return (
    <>
      <PageHead title={t("catalogue.title")} />
      <p className="muted">{t("catalogue.help")}</p>
      <Guide id="catalogue">
        <ol className="stack">
          <li>{t("catalogue.guide.1")}</li>
          <li>{t("catalogue.guide.2")}</li>
          <li>{t("catalogue.guide.3")}</li>
          <li>{t("catalogue.guide.4")}</li>
        </ol>
        <small className="muted">{t("catalogue.guide.note")}</small>
      </Guide>
      {locked && <Notice tone="warn">{t("common.locked")}</Notice>}
      {sp.deleted && <Notice tone="ok">{t("catalogue.deleted")}</Notice>}
      {err in dictionaries.en && <Notice tone="warn">{t(err as "catalogue.err.no_name")}</Notice>}
      <section className="card stack">
        <form className="row" style={{ flexWrap: "nowrap" }} role="search">
          <input name="q" defaultValue={sp.q ?? ""} placeholder={t("catalogue.search")} aria-label={t("catalogue.search")} maxLength={80} style={{ flex: 1 }} />
          <SubmitButton className="btn" type="submit">{t("common.search")}</SubmitButton>
        </form>
        {rows.length === 0 ? <Empty kind="inbox">{q ? t("catalogue.noneMatch") : t("catalogue.none")}</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th /><th>{t("catalogue.name")}</th><th>{t("catalogue.price")}</th><th>{t("catalogue.status")}</th><th /></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td style={{ inlineSize: 56 }}>
                      {i.hasImage && i.active
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={itemPhotoPath(tenant.slug, i)} alt="" width={48} height={48} style={{ objectFit: "cover", borderRadius: 6 }} loading="lazy" />
                        : null}
                    </td>
                    <td><Link href={`/app/catalogue/${i.id}`}><strong dir="auto">{i.name}</strong></Link>{i.nameAr && <><br /><small className="muted" dir="rtl">{i.nameAr}</small></>}</td>
                    <td dir="auto">{i.price ?? <span className="muted">-</span>}</td>
                    <td>{i.active ? <Badge>{t("catalogue.active.short")}</Badge> : <Badge>{t("catalogue.hidden")}</Badge>}{!i.hasImage && <> <small className="muted">{t("catalogue.noPhoto")}</small></>}</td>
                    <td><Link className="btn small ghost" href={`/app/catalogue/${i.id}`}>{t("catalogue.open")}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <small className="muted">{found.length} {t("catalogue.count")}{found.length > SHOWN ? ` (${SHOWN})` : ""}</small>
      </section>
      <section className="card stack">
        <details>
          <summary><strong>{t("catalogue.add")}</strong></summary>
          <form action={saveItemAction} className="stack" style={{ marginBlockStart: ".75rem" }}>
            <fieldset disabled={locked} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <ItemFields t={t} />
              <div><SubmitButton className="btn" type="submit">{t("common.add")}</SubmitButton></div>
            </fieldset>
          </form>
        </details>
      </section>
    </>
  );
}
