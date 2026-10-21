import { describe, expect, it } from "vitest";
import { createBookingService, matchDoctor, parseStart } from "@/lib/booking";
import { inspectConversation } from "@/lib/agent-inspect";
import { buildPrompt } from "@/lib/agent-config";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { seed } from "@/lib/seed";
import { makeDb } from "./helpers/pgdb";

const NOW = new Date("2026-10-21T00:00:00Z"); // Wednesday 03:00 Bahrain

async function setup() {
  const pg = await makeDb();
  const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
  const db: Db = { q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) };
  const data = createPgData(db);
  const t = await data.createTenant({ name: "Tool Clinic", nameAr: "", color: "#112233", domain: "", planType: "package", actor: "x" });
  const hana = (await q<{ id: string }>(`insert into doctors (tenant_id, name, specialty) values ($1, 'Dr. Hana Ali', 'Dentist') returning id`, [t.id]))[0].id;
  await q(`insert into doctors (tenant_id, name) values ($1, 'Dr. Omar Saleh')`, [t.id]);
  const svc = createBookingService(data, null, () => NOW);
  return { data, t, hana, svc };
}

describe("what the agent sends to the booking tools", () => {
  const docs = [{ id: "d1", name: "Dr. Hana Ali" }, { id: "d2", name: "Dr. Omar Saleh" }, { id: "d3", name: "د. ليلى" }];

  it("finds a doctor by id, or by a unique name the model passed instead", () => {
    expect(matchDoctor(docs, "d2")?.id).toBe("d2");
    expect(matchDoctor(docs, "Dr Hana")?.id).toBe("d1");
    expect(matchDoctor(docs, "hana ali")?.id).toBe("d1");
    expect(matchDoctor(docs, "Doctor Omar")?.id).toBe("d2");
    expect(matchDoctor(docs, "الدكتورة ليلى")?.id).toBe("d3");
    expect(matchDoctor(docs, "Dr")).toBeUndefined();
    expect(matchDoctor(docs, "Sara")).toBeUndefined();
  });

  it("reads a time without a zone as Bahrain time, and keeps explicit zones", () => {
    expect(new Date(parseStart("2026-10-21T10:00")).toISOString()).toBe("2026-10-21T07:00:00.000Z");
    expect(new Date(parseStart("2026-10-21 10:00:00")).toISOString()).toBe("2026-10-21T07:00:00.000Z");
    expect(new Date(parseStart("2026-10-21T07:00:00.000Z")).toISOString()).toBe("2026-10-21T07:00:00.000Z");
    expect(new Date(parseStart("2026-10-21T10:00:00+03:00")).toISOString()).toBe("2026-10-21T07:00:00.000Z");
    expect(parseStart("tomorrow at ten")).toBeNaN();
  });

  it("books with a doctor's name and a local time, as a model often sends them", async () => {
    const { svc, t, hana } = await setup();
    const b = await svc.bookAppointment(t.id, { doctorId: "Dr Hana", startsAt: "2026-10-21T10:00", patientName: "Fatima", patientPhone: "+973 3912 3456" });
    expect(b.start).toBe("2026-10-21T07:00:00.000Z");
    expect(b.doctor).toBe("Dr. Hana Ali");
    const again = await svc.checkAvailability(t.id, { doctorId: hana, days: 1 });
    expect(again.slots.map((s) => s.start)).not.toContain("2026-10-21T07:00:00.000Z");
  });

  it("books when the agent passes ElevenLabs' own conversation id (conv_...), which is not a uuid", async () => {
    const { svc, t, data } = await setup();
    const b = await svc.bookAppointment(t.id, { doctorId: "Dr Hana", startsAt: "2026-10-21T10:30", patientName: "Fatima", patientPhone: "+973 3912 3456", conversationId: "conv_01jabc2x9k8qz5t7v3w4m6n1p0" });
    const saved = (await data.getBookings(t.id)).find((x) => x.id === b.bookingId);
    expect(saved?.conversationId).toBe("conv_01jabc2x9k8qz5t7v3w4m6n1p0");
  });

  it("names the doctors when the model passes one that does not exist", async () => {
    const { svc, t } = await setup();
    await expect(svc.checkAvailability(t.id, { doctorId: "Dr Sara" })).rejects.toMatchObject({ code: "unknown_doctor", message: expect.stringContaining("Dr. Hana Ali (doctor_id") });
  });

  it("treats a from_date that is already over (a guessed year) as today", async () => {
    const { svc, t } = await setup();
    const r = await svc.checkAvailability(t.id, { fromDate: "2024-10-21", days: 2 });
    expect(r.slots.length).toBeGreaterThan(0);
    expect(r.slots[0].start >= NOW.toISOString()).toBe(true);
  });
});

describe("tool call log", () => {
  it("keeps each call per client, newest first, and the calls for unknown agents", async () => {
    const { data, t } = await setup();
    await data.logToolCall({ tenantId: t.id, tool: "check_availability", ok: true, detail: "days=7 -> 6 free times", ms: 120 });
    await data.logToolCall({ tenantId: t.id, tool: "book_appointment", ok: false, code: "slot_taken", detail: "starts_at=x -> taken", ms: 80 });
    await data.logToolCall({ tool: "check_availability", ok: false, code: "unknown_agent", detail: "no client", ms: 5 });
    const mine = await data.getToolCalls(t.id, 10);
    expect(mine.map((c) => c.tool)).toEqual(["book_appointment", "check_availability"]);
    expect(mine[0]).toMatchObject({ ok: false, code: "slot_taken" });
    expect((await data.getToolCalls(undefined, 10)).filter((c) => !c.tenantId)).toHaveLength(1);
  });

  it("works in the demo store too", async () => {
    const db = seed();
    expect(db.toolCalls).toEqual([]);
  });
});

describe("ElevenLabs conversation view", () => {
  it("pairs each tool call with its answer and marks failures", () => {
    const c = inspectConversation({
      conversation_id: "conv_1", status: "done", metadata: { start_time_unix_secs: 1792540800, call_duration_secs: 64 },
      transcript: [
        { role: "user", message: "I want to book with Dr Hana tomorrow" },
        { role: "agent", tool_calls: [{ request_id: "r1", tool_name: "check_availability", params_as_json: "{\"days\":1}" }] },
        { role: "agent", tool_results: [{ request_id: "r1", tool_name: "check_availability", result_value: "{\"ok\":true,\"slots\":[]}", is_error: false }] },
        { role: "agent", tool_calls: [{ request_id: "r2", tool_name: "book_appointment", params_as_json: "{}" }] },
        { role: "agent", tool_results: [{ request_id: "r2", tool_name: "book_appointment", result_value: "Request failed with status code 401", is_error: true }] },
        { role: "agent", tool_results: [{ tool_name: "take_message", result_value: "{\"ok\":false,\"error\":\"missing_details\"}" }] },
      ],
    });
    expect(c.opening).toContain("Dr Hana");
    expect(c.seconds).toBe(64);
    expect(c.tools.map((x) => [x.name, x.ok])).toEqual([["check_availability", true], ["book_appointment", false], ["take_message", false]]);
    expect(c.tools[1].answer).toContain("401");
  });
});

describe("agent prompt", () => {
  it("lists the doctors who take bookings with their ids", async () => {
    const { data, t } = await setup();
    const settings = await data.getAgent(t.id);
    const p = buildPrompt(settings, [
      { id: "d1", name: "Dr. Hana", specialty: "Dentist", active: true },
      { id: "d2", name: "Dr. Gone", specialty: "", active: false },
    ]);
    expect(p).toContain("- Dr. Hana, Dentist (doctor_id: d1)");
    expect(p).not.toContain("Dr. Gone");
    expect(p).toContain("exactly as check_availability returned them");
    expect(buildPrompt(settings)).not.toContain("# Doctors");
  });
});
