import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getKnowledge, getUnanswered } from "@/lib/data";
import { addKnowledgeAction, deleteKnowledgeAction, dismissUnansweredAction } from "@/lib/actions";
import { Notice, PageHead } from "@/components/ui";

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ q?: string; saved?: string; deleted?: string }> }) {
  const { tenant } = await requireClient();
  const sp = await searchParams;
  const { t } = await getT();
  const locked = !tenant.permissions.editKnowledge;
  const unanswered = await getUnanswered(tenant.id);
  return (
    <>
      <PageHead title={t("knowledge.title")} />
      {locked && <Notice tone="warn">{t("common.locked")}</Notice>}
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
                    <button className="btn small" type="submit">{t("knowledge.addToFaq")}</button>
                  </div>
                </fieldset>
              </form>
              <form action={dismissUnansweredAction}><input type="hidden" name="id" value={u.id} /><button className="btn small ghost">{t("common.dismiss")}</button></form>
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
            <div><button className="btn" type="submit">{t("common.add")}</button></div>
          </fieldset>
        </form>
      </section>
      <section className="card stack">
        {(await getKnowledge(tenant.id)).length === 0 && <span className="muted">{t("common.none")}</span>}
        {(await getKnowledge(tenant.id)).map((k) => (
          <div key={k.id} className="row" style={{ justifyContent: "space-between", alignItems: "start" }}>
            <div dir={k.language === "ar" ? "rtl" : "ltr"}>
              <strong>{k.question}</strong>
              <div>{k.answer}</div>
            </div>
            {!locked && (
              <form action={deleteKnowledgeAction}>
                <input type="hidden" name="id" value={k.id} />
                <button className="btn small danger">{t("common.delete")}</button>
              </form>
            )}
          </div>
        ))}
      </section>
    </>
  );
}
