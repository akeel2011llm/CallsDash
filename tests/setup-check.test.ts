import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { checkCalendar, googleKeyState, supabaseSecretSet } from "@/lib/setup-check";
import { createGoogleCalendar } from "@/lib/google-calendar";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const key = { client_email: "bot@proj.iam.gserviceaccount.com", private_key: privateKey };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

describe("googleKeyState", () => {
  it("reports missing, invalid and ok without returning the key", () => {
    expect(googleKeyState(undefined)).toEqual({ state: "missing" });
    expect(googleKeyState("  ")).toEqual({ state: "missing" });
    expect(googleKeyState("{not json")).toEqual({ state: "invalid" });
    expect(googleKeyState(JSON.stringify({ client_email: "a@b" }))).toEqual({ state: "invalid" });
    const ok = googleKeyState(JSON.stringify(key));
    expect(ok).toEqual({ state: "ok", email: key.client_email });
    expect(JSON.stringify(ok)).not.toContain("PRIVATE KEY");
  });
});

describe("supabaseSecretSet", () => {
  it("accepts either variable name", () => {
    expect(supabaseSecretSet({})).toBe(false);
    expect(supabaseSecretSet({ SUPABASE_SECRET_KEY: "x" })).toBe(true);
    expect(supabaseSecretSet({ SUPABASE_SERVICE_ROLE_KEY: "x" })).toBe(true);
  });
});

describe("checkCalendar", () => {
  const cal = (handler: (url: string) => Response) => createGoogleCalendar(key, (async (u: string) => handler(String(u))) as unknown as typeof fetch);
  const token = (u: string) => u.includes("oauth2") ? json({ access_token: "t", expires_in: 3600 }) : null;

  it("covers the failure cases an admin can fix", async () => {
    expect(await checkCalendar(null, "x@group.calendar.google.com")).toBe("no_key");
    expect(await checkCalendar(cal(() => json({})), "")).toBe("no_id");
    expect(await checkCalendar(cal((u) => token(u) ?? json({ calendars: { c1: { busy: [] } } })), "c1")).toBe("ok");
    expect(await checkCalendar(cal((u) => token(u) ?? json({ calendars: { c1: { errors: [{ reason: "notFound" }] } } })), "c1")).toBe("not_shared");
    expect(await checkCalendar(cal((u) => u.includes("oauth2") ? json({}, 400) : json({})), "c1")).toBe("key_rejected");
    expect(await checkCalendar(cal((u) => token(u) ?? json({}, 500)), "c1")).toBe("other");
  });
});
