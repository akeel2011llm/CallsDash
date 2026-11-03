/**
 * Sends a plain email through Resend (https://resend.com), with RESEND_API_KEY and BILLING_FROM_EMAIL set in Vercel. Nothing
 * else in CallsDash sends email, so without the key every caller just gets { ok: false, reason: "not_configured" } and the
 * on-screen alert still works. Never throws.
 */
export type MailResult = { ok: true } | { ok: false; reason: "not_configured" | "no_recipient" | "failed"; detail?: string };

export const mailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.BILLING_FROM_EMAIL);

export async function sendEmail(
  mail: { to: string[]; subject: string; text: string },
  fetchImpl: typeof fetch = fetch,
  env: { key?: string; from?: string; base?: string } = {},
): Promise<MailResult> {
  const key = env.key ?? process.env.RESEND_API_KEY, from = env.from ?? process.env.BILLING_FROM_EMAIL;
  if (!key || !from) return { ok: false, reason: "not_configured" };
  if (!mail.to.length) return { ok: false, reason: "no_recipient" };
  try {
    const res = await fetchImpl(`${env.base ?? process.env.RESEND_API_BASE ?? "https://api.resend.com"}/emails`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: mail.to, subject: mail.subject.slice(0, 200), text: mail.text.slice(0, 5000) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, reason: "failed", detail: `${res.status} ${(await res.text()).replace(/\s+/g, " ").slice(0, 160)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "failed", detail: (e instanceof Error ? e.message : String(e)).slice(0, 160) };
  }
}
