import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getAgent } from "@/lib/data";
import { saveAgentAction } from "@/lib/actions";
import { voiceChoices } from "@/lib/voices";
import { Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export default async function VoicePage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { tenant } = await requireClient();
  const { saved } = await searchParams;
  const { t } = await getT();
  const agent = await getAgent(tenant.id);
  const locked = !tenant.permissions.editVoice;
  return (
    <>
      <PageHead title={t("voice.title")} />
      {saved && <Notice tone="ok">{t("agent.saved")}</Notice>}
      {locked && <Notice tone="warn">{t("common.locked")}</Notice>}
      <form action={saveAgentAction} className="stack">
        <input type="hidden" name="returnTo" value="/app/voice" />
        <p className="muted">{t("voice.help")}</p>
        <fieldset disabled={locked} className="grid two">
          {(["en", "ar"] as const).map((lang) => (
            <section key={lang} className="card stack">
              <h2>{lang === "en" ? "English" : "العربية"}</h2>
              {voiceChoices(agent, lang).map((v) => (
                <label key={v.id} className="inline">
                  <input type="radio" name={lang === "en" ? "voiceEn" : "voiceAr"} value={v.id} defaultChecked={(lang === "en" ? agent.voiceEn : agent.voiceAr) === v.id} />
                  <span>{v.name}{v.gender ? ` · ${v.gender === "female" ? t("voice.female") : v.gender === "male" ? t("voice.male") : v.gender}` : ""}{v.accent ? ` · ${v.accent}` : ""}</span>
                  {v.sampleUrl ? <audio controls src={v.sampleUrl} preload="none" /> : <small className="muted">{t("voice.noSample")}</small>}
                </label>
              ))}
            </section>
          ))}
        </fieldset>
        <div><SubmitButton className="btn" type="submit" disabled={locked}>{t("common.save")}</SubmitButton></div>
      </form>
    </>
  );
}
