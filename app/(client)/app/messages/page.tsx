import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/format";
import { getStaffRequests } from "@/lib/data";
import { staffRequestStatusAction } from "@/lib/actions";
import { Badge, Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export default async function MessagesPage() {
  const { tenant } = await requireClient();
  const [{ t, locale }, all] = await Promise.all([getT(), getStaffRequests(tenant.id)]);
  const open = all.filter((r) => r.status === "open").sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.createdAt.localeCompare(a.createdAt));
  const done = all.filter((r) => r.status === "done").slice(0, 20);
  const card = (r: (typeof all)[number]) => (
    <div key={r.id} className="card stack" style={r.urgent && r.status === "open" ? { borderColor: "var(--bad)" } : undefined}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span>
          <strong>{r.name}</strong>{" "}
          <Badge tone={r.kind === "handoff" ? "info" : "neutral"}>{t(`messages.kind.${r.kind}` as "messages.kind.message")}</Badge>{" "}
          {r.urgent && <Badge tone="bad">{t("messages.urgent")}</Badge>}
        </span>
        <small className="muted">{fmtDateTime(r.createdAt, locale)}</small>
      </div>
      <p dir="auto">{r.text}</p>
      <div className="row">
        <a className="btn small ghost" href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} dir="ltr">{t("messages.call")} {r.phone}</a>
        <form action={staffRequestStatusAction}>
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="status" value={r.status === "open" ? "done" : "open"} />
          <SubmitButton className="btn small" type="submit">{r.status === "open" ? t("messages.markDone") : t("messages.reopen")}</SubmitButton>
        </form>
      </div>
    </div>
  );
  return (
    <>
      <PageHead title={t("messages.title")} />
      <p className="muted">{t("messages.help")}</p>
      {open.length === 0 ? <Notice tone="ok">{t("messages.none")}</Notice> : <div className="stack">{open.map(card)}</div>}
      {done.length > 0 && (
        <details>
          <summary>{t("messages.done")} ({done.length})</summary>
          <div className="stack" style={{ marginBlockStart: 12 }}>{done.map(card)}</div>
        </details>
      )}
    </>
  );
}
