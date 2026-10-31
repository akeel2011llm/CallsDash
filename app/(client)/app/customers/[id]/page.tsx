import Link from "next/link";
import { idRuleOf } from "@/lib/id-rule";
import { notFound } from "next/navigation";
import { requireClient } from "@/lib/auth";
import { dictionaries, getT } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/format";
import { getConversations, getCustomer } from "@/lib/data";
import { deleteCustomerAction, saveCustomerAction } from "@/lib/customer-actions";
import { ConfirmDelete } from "@/components/Confirm";
import { CustomerFields } from "@/components/CustomerFields";
import { Badge, Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; err?: string }> }) {
  const { tenant, staffRole } = await requireClient();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [{ t, locale }, c] = await Promise.all([getT(tenant), getCustomer(tenant.id, id)]);
  if (!c) notFound();
  // a history entry holds ElevenLabs' conversation id; the page for it is under CallsDash's own id
  const own = new Map((await getConversations(tenant.id)).filter((x) => x.elevenLabsConversationId).map((x) => [x.elevenLabsConversationId, x.id]));
  const errKey = sp.err && /^[a-z_]+$/.test(sp.err) ? `customers.err.${sp.err}` : "";
  return (
    <>
      <PageHead title={c.name || t("customers.noName")} actions={<Link className="btn small ghost" href="/app/customers">{t("customers.back")}</Link>} />
      {sp.saved && <Notice tone="ok">{t("customers.saved")}</Notice>}
      {errKey in dictionaries.en && <Notice tone="warn">{t(errKey as "customers.err.bad_phone")}</Notice>}
      <div className="grid two">
        <section className="card stack">
          <form action={saveCustomerAction} className="stack">
            <CustomerFields t={t} c={c} id={idRuleOf(tenant)} />
            <div><SubmitButton className="btn" type="submit">{t("customers.save")}</SubmitButton></div>
          </form>
          <small className="muted">{t("customers.since")} {fmtDateTime(c.createdAt, locale)}</small>
        </section>
        <section className="card stack">
          <h2>{t("customers.history")}</h2>
          {c.history.length === 0 ? <p className="muted">{t("customers.history.none")}</p> : (
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {c.history.map((h, i) => (
                <li key={`${h.conversationId ?? i}`} className="stack" style={{ gap: ".15rem" }}>
                  <span><Badge>{t(`channel.${h.channel}` as "channel.website")}</Badge> <small className="muted">{fmtDateTime(h.at, locale)}</small></span>
                  <span dir="auto">{h.summary || "-"}</span>
                  {h.conversationId && own.has(h.conversationId) && <small><Link href={`/app/conversations/${own.get(h.conversationId)}`}>{t("customers.open")}</Link></small>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {staffRole === "manager" && (
        <section className="card">
          <ConfirmDelete action={deleteCustomerAction} summary={t("common.delete")} warning={t("customers.delete.warn")}
            tick={t("common.confirmTick")} button={t("common.delete")} fields={{ id: c.id }} />
        </section>
      )}
    </>
  );
}
