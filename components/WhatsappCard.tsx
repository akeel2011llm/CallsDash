import { getT, type Key } from "@/lib/i18n";
import { saveWhatsappAction, testWhatsappAction } from "@/lib/channel-actions";
import {
  TEMPLATES, addressLine, clinicPhone, confirmationValues, failureHint, mainLanguage, renderTemplate, templateLanguages, wordingOf,
} from "@/lib/whatsapp";
import type { Channel, Locale, Tenant } from "@/lib/types";
import { Badge, Notice } from "@/components/ui";
import { CopyButton } from "@/components/CopyButton";
import { Guide } from "@/components/Guide";
import { SubmitButton } from "@/components/SubmitButton";

const TONE = { off: "neutral", pending: "warn", connected: "ok" } as const;
const NAME: Record<Locale, string> = { en: "English", ar: "العربية" };
const MANAGER = "https://business.facebook.com/latest/whatsapp_manager/message_templates";
const ELEVENLABS = "https://elevenlabs.io/app/agents/whatsapp";
/** A Saturday afternoon, so the preview and the examples read like a real booking. */
const SAMPLE_START = "2026-10-24T13:00:00.000Z";

/**
 * The client's WhatsApp settings: the number, whether and how a booking confirmation is sent, the details printed in it, the
 * exact wording to create at Meta (with copy buttons), a preview, and a test. Everything the admin has to do is written here
 * in order, so the page can be followed without any other guide.
 */
export async function WhatsappCard({ tenant, testFail, wa }: { tenant: Tenant; testFail: string | null; wa?: string }) {
  const { t } = await getT();
  const w = tenant.integrations.whatsapp ?? {};
  const wording = wordingOf(w);
  const spec = TEMPLATES[wording];
  const main = mainLanguage(w);
  const langs = templateLanguages(w);
  const legacy = Boolean(w.confirmTemplate) && !w.confirmWording;
  const templateName = w.confirmTemplate ?? spec.name;
  /** The agent's name in ElevenLabs, as the sync gives it (lib/agent-config.ts), so the admin picks the right one. */
  const agentName = `CallsDash: ${tenant.name}`.slice(0, 120);
  const hidden = <input type="hidden" name="tenantId" value={tenant.id} />;
  const hint = failureHint(testFail ?? undefined);

  // what the patient reads: the clinic's real details with an example patient and booking
  const preview = (l: Locale) => {
    const sample = spec.samples[l];
    return confirmationValues(wording, tenant, w, l, { patientName: sample.name, patientPhone: "", doctorName: sample.doctor, startsAt: SAMPLE_START, service: sample.service, reference: sample.reference ?? "3F2A9C1E", language: l });
  };
  // what Meta asks to be typed next to each variable: the clinic's own wording where it has one
  const examples = (l: Locale) => {
    const values = preview(l);
    return spec.variables.map((k) => [k, k === "address" ? (l === "ar" ? w.addressAr || w.address : w.address || w.addressAr) || spec.samples[l][k] : values[k]] as const);
  };

  const missing = {
    phoneId: !w.phoneNumberId,
    template: !w.confirmTemplate,
    channel: tenant.channels.whatsapp !== "connected",
    address: wording === "full" && !addressLine(w, "en") && !addressLine(w, "ar"),
  };
  const checks: [boolean, Key][] = [
    [!missing.phoneId, "channels.wa.ready.phoneId"],
    [!missing.template, "channels.wa.ready.template"],
    [!missing.channel, "channels.wa.ready.channel"],
    ...(wording === "full" ? [[!missing.address, "channels.wa.ready.address"] as [boolean, Key]] : []),
  ];

  return (
    <section className="card stack" id="whatsapp">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>{t("channels.wa.title")}</h2>
        <Badge tone={TONE[tenant.channels.whatsapp]}>{t(`channels.status.${tenant.channels.whatsapp}` as Key)}</Badge>
      </div>
      <p className="muted">{t("channels.wa.help")}</p>
      {wa && <Notice tone="warn">{t(wa === "failed" ? "channels.wa.failed" : (`channels.wa.skipped.${wa}` as Key))}</Notice>}
      {wa === "failed" && testFail && (
        <Notice tone="warn">
          {hint && <p style={{ margin: 0 }}>{t(`bookings.wa.hint.${hint}` as Key)}</p>}
          <small dir="ltr"><code>{testFail}</code></small>
        </Notice>
      )}
      {legacy && <Notice tone="info">{t("channels.wa.legacy")}</Notice>}

      <ul className="checklist" aria-label={t("channels.wa.ready.title")}>
        {checks.map(([ok, key]) => (
          <li key={key} className={ok ? "done" : undefined}><span className="mark" aria-hidden>✓</span><div><span className="title">{t(key)}</span></div><Badge tone={ok ? "ok" : "warn"}>{ok ? t("channels.env.set") : t("channels.env.missing")}</Badge></li>
        ))}
      </ul>

      <form action={saveWhatsappAction} className="stack">
        {hidden}
        <strong>{t("channels.wa.group.connection")}</strong>
        <div className="grid" style={{ gap: ".75rem", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
          <label>{t("channels.wa.phoneNumberId")}<input name="phoneNumberId" defaultValue={w.phoneNumberId ?? ""} dir="ltr" inputMode="numeric" /><small className="muted">{t("channels.wa.phoneNumberIdHelp")}</small></label>
          <label>{t("channels.wa.number")}<input name="displayNumber" defaultValue={w.displayNumber ?? ""} dir="ltr" inputMode="tel" /></label>
          <label>{t("channels.status")}
            <select name="status" defaultValue={tenant.channels.whatsapp}>
              {(["off", "pending", "connected"] as const).map((s) => <option key={s} value={s}>{t(`channels.status.${s}` as Key)}</option>)}
            </select>
          </label>
        </div>

        <strong>{t("channels.wa.group.message")}</strong>
        <label className="inline"><input type="checkbox" name="confirmations" defaultChecked={w.confirmations !== false} />{t("channels.wa.confirmations")}</label>
        <div className="grid" style={{ gap: ".75rem", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
          <label>{t("channels.wa.wording")}
            <select name="wording" defaultValue={wording}>
              <option value="full">{t("channels.wa.wording.full")}</option>
              <option value="short">{t("channels.wa.wording.short")}</option>
            </select>
          </label>
          <label>{t("channels.wa.template")}<input name="confirmTemplate" defaultValue={templateName} dir="ltr" autoComplete="off" /><small className="muted">{t("channels.wa.templateNameHelp")}</small></label>
          <label>{t("channels.wa.lang")}
            <select name="confirmTemplateLang" defaultValue={main}>{(["en", "ar"] as const).map((l) => <option key={l} value={l}>{NAME[l]}</option>)}</select>
          </label>
        </div>
        <div className="stack" style={{ gap: ".3rem" }}>
          <span>{t("channels.wa.langsCreated")}</span>
          <div className="row">
            {(["en", "ar"] as const).map((l) => <label key={l} className="inline"><input type="checkbox" name={`lang_${l}`} defaultChecked={langs.includes(l)} />{NAME[l]}</label>)}
          </div>
          <small className="muted">{t("channels.wa.langsHelp")}</small>
        </div>

        <strong>{t("channels.wa.group.clinic")}</strong>
        <div className="grid" style={{ gap: ".75rem", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
          <label>{t("channels.wa.address")}<input name="address" defaultValue={w.address ?? ""} maxLength={250} /></label>
          <label>{t("channels.wa.addressAr")}<input name="addressAr" defaultValue={w.addressAr ?? ""} maxLength={250} dir="rtl" lang="ar" /></label>
          <label>{t("channels.wa.mapUrl")}<input name="mapUrl" defaultValue={w.mapUrl ?? ""} maxLength={300} dir="ltr" inputMode="url" placeholder="https://maps.google.com/..." /><small className="muted">{t("channels.wa.mapHelp")}</small></label>
          <label>{t("channels.wa.phone")}<input name="phone" defaultValue={w.phone ?? ""} maxLength={40} dir="ltr" inputMode="tel" placeholder="+973 ..." /><small className="muted">{t("channels.wa.phoneHelp")}</small></label>
        </div>
        <div><SubmitButton className="btn" type="submit">{t("channels.save")}</SubmitButton></div>
      </form>

      <Guide id="whatsapp" plain>
          <strong>{t("channels.wa.link.title")}</strong>
          <ol className="stack" style={{ gap: ".4rem", paddingInlineStart: "1.2rem", margin: 0 }}>
            <li>{t("channels.wa.link.s1")}</li>
            <li><a href={ELEVENLABS} target="_blank" rel="noreferrer">{t("channels.wa.link.s2")}</a></li>
            <li>{t("channels.wa.link.s3")}</li>
            <li>{t("channels.wa.link.s4").replace("{agent}", `“${agentName}”`)}</li>
            <li>{t("channels.wa.link.s5")}</li>
            <li>{t("channels.wa.link.s6")}</li>
          </ol>
          <strong>{t("channels.wa.make.part")}</strong>
          <p className="muted" style={{ margin: 0 }}>{t("channels.wa.make.intro")}</p>
          <ol className="stack" style={{ gap: ".4rem", paddingInlineStart: "1.2rem", margin: 0 }}>
            <li><a href={MANAGER} target="_blank" rel="noreferrer">{t("channels.wa.make.s1")}</a></li>
            <li>{t("channels.wa.make.s2")}</li>
            <li>{t("channels.wa.make.s3").replace("{name}", templateName)}</li>
            <li>{t("channels.wa.make.s4")}</li>
            <li>{t("channels.wa.make.s5")}</li>
            <li>{t("channels.wa.make.s6")}</li>
            <li>{t("channels.wa.make.s7")}</li>
            <li>{t("channels.wa.make.s8")}</li>
            <li>{t("channels.wa.make.s9")}</li>
          </ol>
          <small className="muted">{t("channels.wa.make.codes")}</small>
          {langs.map((l) => (
            <div key={l} className="stack" style={{ gap: ".5rem" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{t("channels.wa.make.text").replace("{lang}", NAME[l])}</strong>
                <CopyButton text={spec.text[l]} label={t("channels.wa.copy")} done={t("channels.wa.copied")} />
              </div>
              <pre style={{ whiteSpace: "pre-wrap", margin: 0 }} dir={l === "ar" ? "rtl" : "ltr"} lang={l}>{spec.text[l]}</pre>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{t("channels.wa.variable")}</th><th>{t("channels.wa.example")}</th><th /></tr></thead>
                  <tbody>
                    {examples(l).map(([k, v]) => (
                      <tr key={k}>
                        <td dir="ltr"><code>{`{{${k}}}`}</code></td>
                        <td dir={l === "ar" ? "rtl" : "ltr"} lang={l}>{v}</td>
                        <td><CopyButton text={v} label={t("channels.wa.copy")} done={t("channels.wa.copied")} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <small className="muted">{t("channels.wa.cost")}</small>
      </Guide>

      <div className="stack" style={{ gap: ".5rem" }}>
        <strong>{t("channels.wa.preview.title")}</strong>
        <small className="muted">{t("channels.wa.preview.note")}</small>
        {wording === "full" && missing.address && <Notice tone="warn">{t("channels.wa.warn.address")}</Notice>}
        {wording === "full" && langs.includes("ar") && !w.addressAr && w.address && <Notice>{t("channels.wa.warn.addressAr")}</Notice>}
        {wording === "full" && !clinicPhone(tenant, w) && <Notice tone="warn">{t("channels.wa.warn.phone")}</Notice>}
        <div className="grid" style={{ gap: ".75rem", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {langs.map((l) => (
            <pre key={l} className="scan-text" style={{ maxBlockSize: "none", margin: 0 }} dir={l === "ar" ? "rtl" : "ltr"} lang={l}>{renderTemplate(wording, l, preview(l))}</pre>
          ))}
        </div>
      </div>

      <form action={testWhatsappAction} className="row" style={{ alignItems: "end" }}>
        {hidden}
        <label style={{ flex: 1, minWidth: 220 }}>{t("channels.wa.testTo")}<input name="to" required dir="ltr" inputMode="tel" placeholder="+973 ..." /></label>
        {langs.length > 1 && (
          <label>{t("channels.wa.testLang")}
            <select name="language" defaultValue={main}>{langs.map((l) => <option key={l} value={l}>{NAME[l]}</option>)}</select>
          </label>
        )}
        <SubmitButton className="btn ghost" type="submit">{t("channels.wa.test")}</SubmitButton>
      </form>
      <small className="muted">{t("channels.wa.testHelp")}</small>
    </section>
  );
}
