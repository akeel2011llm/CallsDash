import type { Calendar } from "./google-calendar";

export type GoogleKeyState = { state: "missing" } | { state: "invalid" } | { state: "ok"; email: string };

/** Looks at the Google key setting without ever returning the key itself; the service account's email is not a secret. */
export function googleKeyState(raw: string | undefined): GoogleKeyState {
  if (!raw?.trim()) return { state: "missing" };
  try {
    const k = JSON.parse(raw) as { client_email?: unknown; private_key?: unknown };
    if (typeof k.client_email === "string" && typeof k.private_key === "string" && k.private_key.includes("PRIVATE KEY")) return { state: "ok", email: k.client_email };
  } catch {
    /* falls through */
  }
  return { state: "invalid" };
}

export const supabaseSecretSet = (env: Record<string, string | undefined> = process.env) => Boolean(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY);

export type CalendarCheck = "ok" | "no_id" | "no_key" | "key_rejected" | "not_shared" | "other";

/** Asks Google for the next hour of one calendar: proves the key works and the calendar is shared with it. Reads only. */
export async function checkCalendar(cal: Calendar | null, calendarId: string | undefined, now = new Date()): Promise<CalendarCheck> {
  if (!calendarId?.trim()) return "no_id";
  if (!cal) return "no_key";
  try {
    await cal.busy(calendarId.trim(), now.toISOString(), new Date(now.getTime() + 3600_000).toISOString());
    return "ok";
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (/token request failed/.test(m)) return "key_rejected";
    if (/not shared/.test(m) || /failed: (404|403)/.test(m)) return "not_shared";
    return "other";
  }
}
