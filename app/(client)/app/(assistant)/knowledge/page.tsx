import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getKnowledge, getUnanswered } from "@/lib/data";
import { addKnowledgeAction, deleteKnowledgeAction, dismissUnansweredAction } from "@/lib/actions";
import { updateKnowledgeAction } from "@/lib/manage-actions";
import { Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ q?: string; lang?: string; saved?: string; deleted?: string }> }) {
  const { tenant } = await requireClient();
  const sp = await searchParams;
  const { t } = await getT(tenant);
  const locked = !tenant.permissions.editKnowledge;
  const [unanswered, all] = await Promise.all([getUnanswered(tenant.id), getKnowledge(tenant.id)]);
  const q = (sp.q ?? "").trim().toLowerCase();
  const lang = sp.lang === "en" || sp.lang === "ar" ? sp.lang : "";
  const items = all.filter((k) => (!q || `${k.question} ${k.answer}`.toLowerCase().includes(q)) && (!lang || k.language === lang));
  return (
    <>
      <PageHead title={t("knowledge.title")} />
      {locked && <Notice tone="warn">{t("common.locked")}</Notice>}
      {sp.saved && <Notice tone="ok">{t("knowledge.saved")}</Notice>}
      {sp.deleted && <Notice tone="ok">{t("knowledge.deleted")}</Notice>}
      {unanswered.length > 0 && (
        <section className="card stack">
          <h2>{t("common.unanswered")}</h2>
          {unanswered.map((u) => (
            <details key={u.id}>
              <summary>{u.text} <span className="muted">×{u.count}</span></summary>
              <form action={addKnowledgeAction} className="stack" style={{ marginTop: ".5rem" }}>
                <input type="hidden" name="unansweredId" value={u.id} />
                <input type="hidden" name="question" value={u.text} />
                <input type="hidden" name="language" value={/[؀-ۿ]/.test(u.text) ? "ar" : "en"} />
                <fieldset disabled={locked}>
                  <textarea name="answer" required maxLength={2000} placeholder={t("knowledge.answer")} />
                  <div className="row">
                    <SubmitButton className="btn small" type="submit">{t("knowledge.addToFaq")}</SubmitButton>
                  </div>
                </fieldset>
              </form>
              <form action={dismissUnansweredAction}><input type="hidden" name="id" value={u.id} /><SubmitButton className="btn small ghost">{t("common.dismiss")}</SubmitButton></form>
            </details>
          ))}
        </section>
      )}
      <section className="card stack">
        <h2>{t("knowledge.add")}</h2>
        <form action={addKnowledgeAction} className="stack">
          <fieldset disabled={locked}>
            <label>{t("knowledge.question")}<input name="question" required maxLength={500} /></label>
            <label>{t("knowledge.answer")}<textarea name="answer" required maxLength={2000} /></label>
            <label>{t("common.language")}
              <select name="language"><option value="en">English</option><option value="ar">العربية</option></select>
            </label>
            <div><SubmitButton className="btn" type="submit">{t("common.add")}</SubmitButton></div>
          </fieldset>
        </form>
      </section>
      <section className="card stack">
        <h2>{t("knowledge.list")} <span className="muted">({all.length})</span></h2>
        <form method="get" className="filters">
          <label>{t("common.search")}<input name="q" defaultValue={sp.q ?? ""} placeholder={t("knowledge.searchPh")} /></label>
          <label>{t("common.language")}
            <select name="lang" defaultValue={lang}>
              <option value="">{t("knowledge.allLanguages")}</option><option value="en">English</option><option value="ar">العربية</option>
            </select>
          </label>
          <SubmitButton className="btn ghost" type="submit">{t("common.apply")}</SubmitButton>
        </form>
        {items.length === 0 && <span className="muted">{t("common.none")}</span>}
        {items.map((k) => (
          <article key={k.id} className="stack" style={{ borderBlockStart: "1px solid var(--line)", paddingBlockStart: ".75rem" }}>
            <div dir={k.language === "ar" ? "rtl" : "ltr"}>
              <strong>{k.question}</strong>
              <div style={{ whiteSpace: "pre-wrap" }}>{k.answer}</div>
            </div>
            {!locked && (
              <div className="row">
                <details style={{ flex: 1 }}>
                  <summary className="muted" style={{ cursor: "pointer" }}>{t("common.edit")}</summary>
                  <form action={updateKnowledgeAction} className="stack" style={{ marginBlockStart: ".5rem" }}>
                    <input type="hidden" name="id" value={k.id} />
                    <input type="hidden" name="returnTo" value={`/app/knowledge${q || lang ? `?${new URLSearchParams({ q: sp.q ?? "", lang })}` : ""}`} />
                    <label>{t("knowledge.question")}<input name="question" required maxLength={500} defaultValue={k.question} /></label>
                    <label>{t("knowledge.answer")}<textarea name="answer" required maxLength={2000} rows={4} defaultValue={k.answer} /></label>
                    <label>{t("common.language")}
                      <select name="language" defaultValue={k.language}><option value="en">English</option><option value="ar">العربية</option></select>
                    </label>
                    <div><SubmitButton className="btn small" type="submit">{t("common.save")}</SubmitButton></div>
                  </form>
                </details>
                <form action={deleteKnowledgeAction}>
                  <input type="hidden" name="id" value={k.id} />
                  <SubmitButton className="btn small danger">{t("common.delete")}</SubmitButton>
                </form>
              </div>
            )}
          </article>
        ))}
      </section>
    </>
  );
}
