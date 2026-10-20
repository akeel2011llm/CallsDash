import Link from "next/link";
import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/format";
import { getConversations } from "@/lib/data";
import { setAlertRulesAction, reviewConversationAction } from "@/lib/actions";
import { BUILT_IN_KEYWORDS, FLAG_KINDS, flagRank } from "@/lib/flags";
import { Flag, Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import type { FlagKind } from "@/lib/types";

type SP = { kind?: string; show?: string; rules?: string };

export default async function AttentionPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { tenant } = await requireClient();
  const sp = await searchParams;
  const { t, locale } = await getT();
  const kind = FLAG_KINDS.find((k) => k === sp.kind);
  const showReviewed = sp.show === "reviewed";
  const flagged = (await getConversations(tenant.id)).filter((c) => c.flags.length > 0);
  const rows = flagged
    .filter((c) => c.reviewed === showReviewed && (!kind || c.flags.includes(kind)))
    .sort((a, b) => Math.min(...a.flags.map((f) => flagRank[f])) - Math.min(...b.flags.map((f) => flagRank[f])) || b.startedAt.localeCompare(a.startedAt));
  const open = flagged.filter((c) => !c.reviewed);
  const count = (k: FlagKind) => open.filter((c) => c.flags.includes(k)).length;
  const href = (p: { kind?: string; show?: string }) => {
    const q = new URLSearchParams();
    if (p.kind) q.set("kind", p.kind);
    if (p.show) q.set("show", p.show);
    const s = q.toString();
    return `/app/attention${s ? `?${s}` : ""}`;
  };
  const returnTo = href({ kind, show: showReviewed ? "reviewed" : undefined });
  return (
    <>
      <PageHead title={t("attn.title")} subtitle={t("attn.help")} />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <nav className="seg" aria-label={t("attn.title")}>
          <Link href={href({ show: showReviewed ? "reviewed" : undefined })} className={!kind ? "on" : ""}>{t("attn.all")}</Link>
          {FLAG_KINDS.map((k) => (
            <Link key={k} href={href({ kind: k, show: showReviewed ? "reviewed" : undefined })} className={kind === k ? "on" : ""}>
              {t(`flag.${k}` as "flag.lead")}{!showReviewed && count(k) > 0 ? ` (${count(k)})` : ""}
            </Link>
          ))}
        </nav>
        <nav className="seg">
          <Link href={href({ kind })} className={!showReviewed ? "on" : ""}>{t("attn.title")}</Link>
          <Link href={href({ kind, show: "reviewed" })} className={showReviewed ? "on" : ""}>{t("attn.reviewed")}</Link>
        </nav>
      </div>
      {sp.rules === "saved" && <Notice tone="ok">{t("attn.saved")}</Notice>}
      {rows.length === 0 ? <Notice tone="ok">{t("attn.none")}</Notice> : (
        <div className="attn">
          {rows.map((c) => {
            const top = c.flags.slice().sort((a, b) => flagRank[a] - flagRank[b])[0];
            return (
              <div key={c.id} className={`attn-item ${top}`}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="row">
                    {c.flags.slice().sort((a, b) => flagRank[a] - flagRank[b]).map((f) => <Flag key={f} kind={f}>{t(`flag.${f}` as "flag.lead")}</Flag>)}
                    <small className="muted">{fmtDateTime(c.startedAt, locale)} · {t(`channel.${c.channel}` as "channel.website")}</small>
                  </span>
                  <span className="row">
                    <Link className="btn small ghost" href={`/app/conversations/${c.id}`}>{t("attn.open")}</Link>
                    <form action={reviewConversationAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="reviewed" value={c.reviewed ? "0" : "1"} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <SubmitButton className="btn small" type="submit">{c.reviewed ? t("attn.reopen") : t("attn.markReviewed")}</SubmitButton>
                    </form>
                  </span>
                </div>
                <div dir={c.language === "ar" ? "rtl" : "ltr"}>{c.summary}</div>
              </div>
            );
          })}
        </div>
      )}

      <section id="rules" className="card stack">
        <div>
          <h2>{t("attn.rules")}</h2>
          <p className="muted">{t("attn.rules.help")}</p>
        </div>
        <form action={setAlertRulesAction} className="stack">
          <div className="grid">
            {FLAG_KINDS.map((k) => (
              <fieldset key={k} className="stack" style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "1rem" }}>
                <legend><Flag kind={k}>{t(`flag.${k}` as "flag.lead")}</Flag></legend>
                <small className="muted">{t(`flag.${k}.help` as "flag.lead.help")}</small>
                <label className="inline"><input type="checkbox" name={`${k}_enabled`} defaultChecked={tenant.alertRules[k].enabled} style={{ inlineSize: "auto" }} />{t("attn.rule.enabled")}</label>
                <label className="inline"><input type="checkbox" name={`${k}_notify`} defaultChecked={tenant.alertRules[k].notifyStaff} style={{ inlineSize: "auto" }} />{t("attn.rule.notify")}</label>
                <label>{t("attn.rule.keywords")}
                  <textarea name={`${k}_keywords`} rows={3} defaultValue={tenant.alertRules[k].keywords.join("\n")} dir="auto" />
                </label>
                <details>
                  <summary>{t("attn.rule.builtin")}</summary>
                  <small className="muted" dir="auto">{BUILT_IN_KEYWORDS[k].join(" · ")}</small>
                </details>
              </fieldset>
            ))}
          </div>
          <div><SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton></div>
        </form>
      </section>
    </>
  );
}
