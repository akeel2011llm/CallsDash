import Link from "next/link";
import { requireClient } from "@/lib/auth";
import { dictionaries, getT } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/format";
import { getCustomers } from "@/lib/data";
import { saveCustomerAction } from "@/lib/customer-actions";
import { phoneKey } from "@/lib/customers";
import { Empty, Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { CustomerFields } from "@/components/CustomerFields";

const SHOWN = 200;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; deleted?: string; err?: string }> }) {
  const { tenant } = await requireClient();
  const sp = await searchParams;
  const [{ t, locale }, all] = await Promise.all([getT(), getCustomers(tenant.id)]);
  const q = (sp.q ?? "").trim().toLowerCase();
  const digits = phoneKey(q) ? q.replace(/\D/g, "") : "";
  const found = q ? all.filter((c) => `${c.name} ${c.email ?? ""}`.toLowerCase().includes(q) || (digits && c.phone.replace(/\D/g, "").includes(digits))) : all;
  const rows = found.slice(0, SHOWN);
  const err = sp.err && /^[a-z_]+$/.test(sp.err) ? `customers.err.${sp.err}` : "";
  return (
    <>
      <PageHead title={t("customers.title")} actions={all.length > 0 ? <a className="btn small ghost" href="/app/customers/csv">{t("customers.export")}</a> : undefined} />
      <p className="muted">{t("customers.help")}</p>
      {sp.deleted && <Notice tone="ok">{t("customers.deleted")}</Notice>}
      {err in dictionaries.en && <Notice tone="warn">{t(err as "customers.err.bad_phone")}</Notice>}
      <section className="card stack">
        <form className="row" style={{ flexWrap: "nowrap" }} role="search">
          <input name="q" defaultValue={sp.q ?? ""} placeholder={t("customers.search")} aria-label={t("customers.search")} maxLength={80} style={{ flex: 1 }} />
          <SubmitButton className="btn" type="submit">{t("common.search")}</SubmitButton>
        </form>
        {rows.length === 0 ? <Empty kind="inbox">{q ? t("customers.noneMatch") : t("customers.none")}</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t("customers.name")}</th><th>{t("customers.phone")}</th><th>{t("customers.language")}</th><th>{t("customers.last")}</th><th /></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/app/customers/${c.id}`}><strong dir="auto">{c.name || t("customers.noName")}</strong></Link></td>
                    <td dir="ltr">{c.phone}</td>
                    <td>{c.language === "ar" ? "العربية" : c.language === "en" ? "English" : <span className="muted">{t("customers.language.none")}</span>}</td>
                    <td>{fmtDateTime(c.lastContactAt ?? c.createdAt, locale)}</td>
                    <td><Link className="btn small ghost" href={`/app/customers/${c.id}`}>{t("customers.open")}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <small className="muted">{found.length} {t("customers.count")}{found.length > SHOWN ? ` (${SHOWN})` : ""}</small>
      </section>
      <section className="card stack">
        <details>
          <summary><strong>{t("customers.add")}</strong></summary>
          <form action={saveCustomerAction} className="stack" style={{ marginBlockStart: ".75rem" }}>
            <CustomerFields t={t} />
            <div><SubmitButton className="btn" type="submit">{t("common.add")}</SubmitButton></div>
          </form>
        </details>
        <small className="muted">{t("customers.privacy")}</small>
      </section>
    </>
  );
}
