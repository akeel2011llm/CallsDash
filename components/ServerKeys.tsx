import type { Key } from "@/lib/i18n";
import { googleKeyState, supabaseSecretSet } from "@/lib/setup-check";
import { HEADER_SETTINGS, headerSafe } from "@/lib/header-safe";
import { Fold } from "./Fold";
import { Badge } from "./ui";
import { SecretGenerator } from "./SecretGenerator";

const ENV = ["SUPABASE_SERVICE_ROLE_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON", "ELEVENLABS_API_KEY", "AGENT_TOOLS_SECRET", "ELEVENLABS_WEBHOOK_SECRET", "META_APP_SECRET", "META_VERIFY_TOKEN", "NEXT_PUBLIC_SITE_URL"] as const;

/**
 * Set or Missing for every server key in Vercel. These belong to the whole platform, not one client, so they live in Platform
 * settings (they used to sit on each client's Channels page).
 */
export function ServerKeys({ t }: { t: (k: Key) => string }) {
  return (
      <Fold id="keys" title={t("channels.env.title")}>
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
      </Fold>
  );
}
