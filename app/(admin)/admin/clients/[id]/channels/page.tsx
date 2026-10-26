import Link from "next/link";
import { notFound } from "next/navigation";
import { getT, type Key } from "@/lib/i18n";
import * as store from "@/lib/data";
import { appUrl } from "@/lib/app-url";
import { fmtDateTime } from "@/lib/format";
import { testFailKey, testFailToShow } from "@/lib/whatsapp";
import { saveInstagramAction, savePhoneAction, syncAgentAction, useAgentAction } from "@/lib/channel-actions";
import { WhatsappCard } from "@/components/WhatsappCard";
import { Badge, Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import type { Channel } from "@/lib/types";
import { googleKeyState, supabaseSecretSet } from "@/lib/setup-check";
import { HEADER_SETTINGS, headerSafe } from "@/lib/header-safe";
import { SecretGenerator } from "@/components/SecretGenerator";

const ENV = ["SUPABASE_SERVICE_ROLE_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON", "ELEVENLABS_API_KEY", "AGENT_TOOLS_SECRET", "ELEVENLABS_WEBHOOK_SECRET", "META_APP_SECRET", "META_VERIFY_TOKEN", "NEXT_PUBLIC_SITE_URL"] as const;
const TONE = { off: "neutral", pending: "warn", connected: "ok" } as const;

export default async function Channels({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string; wa?: string }> }) {
  const { id } = await params;
  const { saved, error, wa } = await searchParams;
  const tenant = await store.getTenant(id);
  if (!tenant) notFound();
  const [{ t, locale }, agent, secrets, url, testFail] = await Promise.all([
    getT(), store.getAgent(id), store.getSecrets(id), appUrl(),
    wa === "failed" ? store.getSetting(testFailKey(id)).then((v) => testFailToShow(v)) : Promise.resolve(null),
  ]);
  const el = tenant.integrations.elevenlabs;
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

      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{t("channels.agent.title")}</h2>
          <Badge tone={agent.elevenLabsAgentId ? "ok" : "warn"}>{agent.elevenLabsAgentId ? t("channels.agent.ready") : t("channels.agent.none")}</Badge>
        </div>
        <p className="muted">{t("channels.agent.help")}</p>
        {el?.error && <Notice tone="warn"><strong>{t("channels.agent.error")}:</strong> <span dir="ltr">{el.error}</span></Notice>}
        {el?.warnings?.length ? (
          <Notice tone="warn">
            <strong>{t("channels.agent.warnings")}</strong>
            <ul>{el.warnings.map((w) => <li key={w.group}>{t(`channels.group.${w.group}` as Key)}: <span dir="ltr">{w.detail}</span></li>)}</ul>
          </Notice>
        ) : null}
        <dl className="scan-grid">
          {agent.elevenLabsAgentId && <><dt>ID</dt><dd dir="ltr"><code>{agent.elevenLabsAgentId}</code> · <a href={`https://elevenlabs.io/app/agents`} target="_blank" rel="noreferrer">{t("channels.agent.open")}</a></dd></>}
          {el?.syncedAt && <><dt>{t("channels.agent.synced")}</dt><dd>{fmtDateTime(el.syncedAt, locale)}</dd></>}
        </dl>
        <small className="muted">{t("channels.agent.extras")}</small>
        <form action={syncAgentAction}>{hidden}<SubmitButton className="btn" type="submit">{agent.elevenLabsAgentId ? t("channels.agent.sync") : t("channels.agent.create")}</SubmitButton></form>
        <div className="stack" style={{ gap: ".5rem", borderTop: "1px solid var(--line)", paddingTop: ".75rem" }}>
          <h3 style={{ margin: 0 }}>{t("channels.agent.other.title")}</h3>
          <p className="muted" style={{ margin: 0 }}>{t("channels.agent.other.help")}</p>
          <form action={useAgentAction} className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            {hidden}
            <label style={{ flex: "1 1 18rem" }}>{t("channels.agent.other.id")}<input name="agentId" dir="ltr" placeholder="agent_…" required autoComplete="off" spellCheck={false} /></label>
            <SubmitButton className="btn" type="submit">{t("channels.agent.other.use")}</SubmitButton>
          </form>
          {el?.others?.length ? (
            <>
              <strong>{t("channels.agent.other.before")}</strong>
              <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: ".4rem" }}>
                {el.others.map((o) => (
                  <li key={o.id} className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                    <span dir="ltr">{o.name ? `${o.name} · ` : ""}<code>{o.id}</code></span>
                    <form action={useAgentAction}>{hidden}<input type="hidden" name="agentId" value={o.id} /><SubmitButton className="btn ghost" type="submit">{t("channels.agent.other.switch")}</SubmitButton></form>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
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

      <WhatsappCard tenant={tenant} testFail={testFail} wa={wa} />

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
            const unsendable = (HEADER_SETTINGS as readonly string[]).includes(name) && Boolean(process.env[name]) && !headerSafe(process.env[name]);
            const set = !unsendable && (name === "SUPABASE_SERVICE_ROLE_KEY" ? supabaseSecretSet() : google ? google.state === "ok" : Boolean(process.env[name]));
            const bad = google?.state === "invalid" || unsendable;
            return (
              <li key={name} className={set ? "done" : undefined}>
                <span className="mark" aria-hidden>✓</span>
                <div>
                  <span className="title" dir="ltr">{name}</span><small>{t(`channels.env.${name}` as Key)}</small>
                  {google?.state === "ok" && <small>{t("channels.env.googleShare")} <code dir="ltr">{google.email}</code></small>}
                  {google?.state === "invalid" && <small>{t("channels.env.googleInvalid")}</small>}
                  {unsendable && <small>{t("channels.env.badChars")}</small>}
                </div>
                <Badge tone={set ? "ok" : "warn"}>{set ? t("channels.env.set") : bad ? t("channels.env.invalid") : t("channels.env.missing")}</Badge>
              </li>
            );
          })}
        </ul>
        <div className="stack">
          <strong>{t("secret.title")}</strong>
          <small className="muted">{t("secret.help")}</small>
          <SecretGenerator labels={{ make: t("secret.make"), copy: t("secret.copy"), copied: t("secret.copied"), hint: t("secret.hint") }} />
        </div>
      </section>
    </>
  );
}
