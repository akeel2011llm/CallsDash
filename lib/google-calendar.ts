import { createSign } from "node:crypto";

/**
 * Minimal Google Calendar client using a service account (no OAuth screen needed): each clinic shares its doctors'
 * calendars with the service account's email ("Make changes to events"), and the calendar ids are saved per doctor.
 * Env: GOOGLE_SERVICE_ACCOUNT_JSON (the key file's JSON, as one line).
 */
export interface Calendar {
  busy(calendarId: string, fromIso: string, toIso: string): Promise<{ start: string; end: string }[]>;
  createEvent(calendarId: string, e: EventInput): Promise<string>;
  updateEvent(calendarId: string, eventId: string, e: EventInput): Promise<void>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

export interface Reminder { method: "popup" | "email"; minutes: number }
export interface EventInput { summary: string; description?: string; startIso: string; endIso: string; reminders?: Reminder[] }

/** A day before by email, then pop-ups an hour and 15 minutes before: reaches whoever owns the doctor's calendar. */
export const DEFAULT_REMINDERS: Reminder[] = [{ method: "email", minutes: 1440 }, { method: "popup", minutes: 60 }, { method: "popup", minutes: 15 }];

const eventBody = (e: EventInput) => ({
  summary: e.summary, description: e.description,
  start: { dateTime: e.startIso }, end: { dateTime: e.endIso },
  reminders: { useDefault: false, overrides: e.reminders ?? DEFAULT_REMINDERS },
});

type Fetch = typeof fetch;
const API = "https://www.googleapis.com/calendar/v3";
/** A silent Google must not hang a page or a phone call: give up and say so. */
const TIMEOUT_MS = 10_000;
const b64 = (v: string | Buffer) => Buffer.from(v).toString("base64url");

export function googleCalendarFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl: Fetch = fetch): Calendar | null {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) return null;
  const key = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as { client_email: string; private_key: string };
  return createGoogleCalendar(key, fetchImpl);
}

export function createGoogleCalendar(key: { client_email: string; private_key: string }, f: Fetch = fetch, now: () => number = Date.now): Calendar {
  let token: { value: string; expiresAt: number } | undefined;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt - 60_000 > now()) return token.value;
    const iat = Math.floor(now() / 1000);
    const claim = b64(JSON.stringify({ iss: key.client_email, scope: "https://www.googleapis.com/auth/calendar", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }));
    const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const sig = createSign("RSA-SHA256").update(`${head}.${claim}`).sign(key.private_key, "base64url");
    const res = await f("https://oauth2.googleapis.com/token", {
      method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }),
    });
    if (!res.ok) throw new Error(`Google token request failed: ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: j.access_token, expiresAt: now() + j.expires_in * 1000 };
    return token.value;
  }

  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await f(`${API}${path}`, {
      method, signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok && !(method === "DELETE" && (res.status === 404 || res.status === 410))) throw new Error(`Google Calendar ${method} ${path.split("?")[0]} failed: ${res.status}`);
    return res;
  }
  const cal = (id: string) => encodeURIComponent(id);

  return {
    async busy(calendarId, fromIso, toIso) {
      const res = await call("POST", "/freeBusy", { timeMin: fromIso, timeMax: toIso, items: [{ id: calendarId }] });
      const j = (await res.json()) as { calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> };
      const c = j.calendars?.[calendarId];
      if (!c || c.errors?.length) throw new Error(`Google Calendar ${calendarId} is not shared with the service account`);
      return c.busy ?? [];
    },
    async createEvent(calendarId, e) {
      const res = await call("POST", `/calendars/${cal(calendarId)}/events`, eventBody(e));
      return ((await res.json()) as { id: string }).id;
    },
    async updateEvent(calendarId, eventId, e) {
      await call("PATCH", `/calendars/${cal(calendarId)}/events/${encodeURIComponent(eventId)}`, eventBody(e));
    },
    async deleteEvent(calendarId, eventId) {
      await call("DELETE", `/calendars/${cal(calendarId)}/events/${encodeURIComponent(eventId)}`);
    },
  };
}
