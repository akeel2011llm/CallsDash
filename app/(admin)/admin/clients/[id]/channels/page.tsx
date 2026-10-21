import Link from "next/link";
import { notFound } from "next/navigation";
import { getT, type Key } from "@/lib/i18n";
import * as store from "@/lib/data";
import { appUrl } from "@/lib/app-url";
import { fmtDateTime } from "@/lib/format";
import { CONFIRMATION_TEMPLATE } from "@/lib/whatsapp";
import { saveInstagramAction, savePhoneAction, saveWhatsappAction, syncAgentAction, testWhatsappAction } from "@/lib/channel-actions";
import { Badge, Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import type { Channel } from "@/lib/types";
import { googleKeyState, supabaseSecretSet } from "@/lib/setup-check";

const ENV = ["SUPABASE_SERVICE_ROLE_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON", "ELEVENLABS_API_KEY", "AGENT_TOOLS_SECRET", "ELEVENLABS_WEBHOOK_SECRET", "META_APP_SECRET", "META_VERIFY_TOKEN", "NEXT_PUBLIC_SITE_URL"] as const;
const TONE = { off: "neutral", pending: "warn", connected: "ok" } as const;

export default async function Channels({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string; wa?: string }> }) {
  const { id } = await params;
  const { saved, error, wa } = await searchParams;
  const tenant = await store.getTenant(id);
  if (!tenant) notFound();
  const [{ t, locale }, agent, secrets, url] = await Promise.all([getT(), store.getAgent(id), store.getSecrets(id), appUrl()]);
  const el = tenant.integrations.elevenlabs;
  const wa_ = tenant.integrations.whatsapp ?? {};
  const ig = tenant.integrations.instagram ?? {};
  const ph = tenant.integrations.phone ?? {};
  const base = `/admin/clients/${id}`;
  const snippet = `<script src="${url}/widget.js" data-tenant="${tenant.slug}" async></script>`;
  const statusSelect = (ch: Channel) => (
    <label>{t("channels.status")}
      <select name="status" defaultValue={tenant.channels[ch]}>
        {(["off", "pending", "connected"] as const).map((s) => <option key={s} value={s}>{t(`channels.status.${s}` as Key)}</option>)}
      </select>
    </label>
  );
  const hidden = <input type="hidden" name="tenantId" value={id} />;
  return (
    <>
      <PageHead title={`${t("channels.title")}: ${locale === "ar" ? tenant.branding.displayNameAr : tenant.name}`} subtitle={t("channels.subtitle")} actions={<Link className="btn ghost" href={base}>{t("common.back")}</Link>} />
      {saved && <Notice tone="ok">{saved === "1" ? t("channels.saved") : t(`channels.saved.${saved}` as Key)}</Notice>}
      {error && <Notice tone="warn">{t(`channels.err.${error}` as Key)}</Notice>}
      {wa && <Notice tone="warn">{t(wa === "failed" ? "channels.wa.failed" : (`channels.wa.skipped.${wa}` as Key))}</Notice>}

      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{t("channels.agent.title")}</h2>
          <Badge tone={agent.elevenLabsAgentId ? "ok" : "warn"}>{agent.elevenLabsAgentId ? t("channels.agent.ready") : t("channels.agent.none")}</Badge>
        </div>
        <p className="muted">{t("channels.agent.help")}</p>
        {el?.error && <Notice tone="warn"><strong>{t("channels.agent.error")}:</strong> <span dir="ltr">{el.error}</span></Notice>}
        <dl className="scan-grid">
          {agent.elevenLabsAgentId && <><dt>ID</dt><dd dir="ltr"><code>{agent.elevenLabsAgentId}</code> · <a href={`https://elevenlabs.io/app/agents`} target="_blank" rel="noreferrer">{t("channels.agent.open")}</a></dd></>}
          {el?.syncedAt && <><dt>{t("channels.agent.synced")}</dt><dd>{fmtDateTime(el.syncedAt, locale)}</dd></>}
        </dl>
        <form action={syncAgentAction}>{hidden}<SubmitButton className="btn" type="submit">{agent.elevenLabsAgentId ? t("channels.agent.sync") : t("channels.agent.create")}</SubmitButton></form>
      </section>

      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{t("channels.website.title")}</h2>
          <Badge tone={TONE[tenant.channels.website]}>{t(`channels.status.${tenant.channels.website}` as Key)}</Badge>
        </div>
        <p className="muted">{t("channels.website.help")}</p>
        <div><strong>{t("channels.website.snippet")}</strong><pre>{snippet}</pre></div>
        <div><strong>{t("channels.website.domains")}:</strong> <span dir="ltr">{tenant.allowedDomains.join(", ") || "–"}</span></div>
      </section>

      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{t("channels.wa.title")}</h2>
          <Badge tone={TONE[tenant.channels.whatsapp]}>{t(`channels.status.${tenant.channels.whatsapp}` as Key)}</Badge>
        </div>
        <p className="muted">{t("channels.wa.help")}</p>
        <form action={saveWhatsappAction} className="stack">
          {hidden}
          <div className="grid" style={{ gap: ".75rem", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
            <label>{t("channels.wa.phoneNumberId")}<input name="phoneNumberId" defaultValue={wa_.phoneNumberId ?? ""} dir="ltr" inputMode="numeric" /></label>
            <label>{t("channels.wa.number")}<input name="displayNumber" defaultValue={wa_.displayNumber ?? ""} dir="ltr" inputMode="tel" /></label>
            <label>{t("channels.wa.template")}<input name="confirmTemplate" defaultValue={wa_.confirmTemplate ?? CONFIRMATION_TEMPLATE.name} dir="ltr" /></label>
            <label>{t("channels.wa.lang")}<select name="confirmTemplateLang" defaultValue={wa_.confirmTemplateLang ?? "en"}><option value="en">English</option><option value="ar">العربية</option></select></label>
            {statusSelect("whatsapp")}
          </div>
          <details>
            <summary className="muted" style={{ cursor: "pointer" }}>{t("channels.wa.templateHelp")}</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>{CONFIRMATION_TEMPLATE.en}{"\n\n"}{CONFIRMATION_TEMPLATE.ar}</pre>
          </details>
          <div><SubmitButton className="btn" type="submit">{t("channels.save")}</SubmitButton></div>
        </form>
        <form action={testWhatsappAction} className="row" style={{ alignItems: "end" }}>
          {hidden}
          <label style={{ flex: 1, minWidth: 220 }}>{t("channels.wa.testTo")}<input name="to" required dir="ltr" inputMode="tel" placeholder="+973 ..." /></label>
          <SubmitButton className="btn ghost" type="submit">{t("channels.wa.test")}</SubmitButton>
        </form>
      </section>

      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{t("channels.ig.title")}</h2>
          <Badge tone={TONE[tenant.channels.instagram]}>{t(`channels.status.${tenant.channels.instagram}` as Key)}</Badge>
        </div>
        <p className="muted">{t("channels.ig.help")}</p>
        <div className="stack" style={{ gap: ".35rem" }}>
          <strong>{t("channels.ig.urls")}</strong>
          <dl className="scan-grid">
            <dt>{t("channels.ig.callback")}</dt><dd dir="ltr"><code>{url}/api/webhooks/instagram</code></dd>
            <dt>{t("channels.ig.verify")}</dt><dd dir="ltr"><code>META_VERIFY_TOKEN</code></dd>
            <dt>{t("channels.ig.reply")}</dt><dd dir="ltr"><code>{url}/api/webhooks/instagram/reply/{tenant.slug}</code></dd>
          </dl>
        </div>
        <form action={saveInstagramAction} className="stack">
          {hidden}
          <div className="grid" style={{ gap: ".75rem", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
            <label>{t("channels.ig.accountId")}<input name="accountId" defaultValue={ig.accountId ?? ""} dir="ltr" inputMode="numeric" /></label>
            <label>{t("channels.ig.username")}<input name="username" defaultValue={ig.username ?? ""} dir="ltr" /></label>
            <label style={{ gridColumn: "1 / -1" }}>{t("channels.ig.inboundUrl")}<input name="inboundUrl" defaultValue={ig.inboundUrl ?? ""} dir="ltr" placeholder="https://api.elevenlabs.io/v1/convai/api-integrations/custom_channel/triggers/.../async_message" /></label>
            {([["token", "instagramToken"], ["inboundSecret", "instagramInboundSecret"], ["replySecret", "instagramReplySecret"]] as const).map(([field, key]) => (
              <label key={field}>{t(`channels.ig.${field}` as Key)}
                <input name={field} type="password" autoComplete="new-password" dir="ltr" placeholder={secrets[key] ? "••••••••" : ""} />
                {secrets[key] && <span className="row"><small className="muted">{t("channels.ig.keep")}</small><label className="inline"><input type="checkbox" name={`clear_${field}`} />{t("channels.ig.clear")}</label></span>}
              </label>
            ))}
            {statusSelect("instagram")}
          </div>
          <div><SubmitButton className="btn" type="submit">{t("channels.save")}</SubmitButton></div>
        </form>
      </section>

      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{t("channels.phone.title")}</h2>
          <Badge tone={TONE[tenant.channels.phone]}>{t(`channels.status.${tenant.channels.phone}` as Key)}</Badge>
        </div>
        <p className="muted">{t("channels.phone.help")}</p>
        <form action={savePhoneAction} className="stack">
          {hidden}
          <div className="grid" style={{ gap: ".75rem", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
            <label>{t("channels.phone.number")}<input name="number" defaultValue={ph.number ?? ""} dir="ltr" inputMode="tel" /></label>
            <label>{t("channels.phone.provider")}
              <select name="provider" defaultValue={ph.provider ?? ""}>
                <option value="" />
                {(["twilio", "sip", "other"] as const).map((p) => <option key={p} value={p}>{t(`channels.phone.${p}` as Key)}</option>)}
              </select>
            </label>
            {statusSelect("phone")}
          </div>
          <div><SubmitButton className="btn" type="submit">{t("channels.save")}</SubmitButton></div>
        </form>
      </section>

      <section className="card stack">
        <h2>{t("channels.env.title")}</h2>
        <p className="muted">{t("channels.env.help")}</p>
        <ul className="checklist">
          {ENV.map((name) => {
            const google = name === "GOOGLE_SERVICE_ACCOUNT_JSON" ? googleKeyState(process.env[name]) : null;
            const set = name === "SUPABASE_SERVICE_ROLE_KEY" ? supabaseSecretSet() : google ? google.state === "ok" : Boolean(process.env[name]);
            const bad = google?.state === "invalid";
            return (
              <li key={name} className={set ? "done" : undefined}>
                <span className="mark" aria-hidden>✓</span>
                <div>
                  <span className="title" dir="ltr">{name}</span><small>{t(`channels.env.${name}` as Key)}</small>
                  {google?.state === "ok" && <small>{t("channels.env.googleShare")} <code dir="ltr">{google.email}</code></small>}
                  {bad && <small>{t("channels.env.googleInvalid")}</small>}
                </div>
                <Badge tone={set ? "ok" : "warn"}>{set ? t("channels.env.set") : bad ? t("channels.env.invalid") : t("channels.env.missing")}</Badge>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
