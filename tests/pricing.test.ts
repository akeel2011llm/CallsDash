import { describe, expect, it } from "vitest";
import { DEFAULT_FEES, USD_TO_BHD, cleanFees, clientRatePerCredit, costLine, fmtBhd, fmtUsd, marginOf, marginTone, monthlyCostUsd, toBhd } from "@/lib/pricing";
import type { Plan } from "@/lib/types";

const pkg = (over: Partial<Plan> = {}): Plan => ({
  id: "p1", type: "package", name: "Standard", monthlyPriceBhd: 199, includedCredits: 2500, pricePerCreditBhd: 0.08, active: true, ...over,
} as Plan);
const payg = (over: Partial<Plan> = {}): Plan => ({ id: "p2", type: "payg", name: "Pay as you go", monthlyPriceBhd: 20, includedCredits: 0, pricePerCreditBhd: 0.11, active: true, ...over } as Plan);

describe("fees", () => {
  it("defaults to ElevenLabs' list price", () => {
    expect(DEFAULT_FEES).toEqual({ minuteUsd: 0.08, messageUsd: 0.003 });
  });
  it("cleans what is stored", () => {
    expect(cleanFees(undefined)).toEqual(DEFAULT_FEES);
    expect(cleanFees({ minuteUsd: 0.1, messageUsd: 0.004 })).toEqual({ minuteUsd: 0.1, messageUsd: 0.004 });
    expect(cleanFees({ minuteUsd: -1, messageUsd: "x" })).toEqual(DEFAULT_FEES);
    expect(cleanFees({ minuteUsd: 99, messageUsd: NaN })).toEqual(DEFAULT_FEES);
    expect(cleanFees({ minuteUsd: 0, messageUsd: 0 })).toEqual({ minuteUsd: 0, messageUsd: 0 });
  });
});

describe("cost of a conversation", () => {
  it("adds the model's share to ElevenLabs' fee", () => {
    const c = costLine({ perMinute: 0.01, perMessage: 0.0005 }, DEFAULT_FEES);
    expect(c.minuteUsd).toBeCloseTo(0.09, 10);
    expect(c.messageUsd).toBeCloseTo(0.0035, 10);
  });
  it("prices a month of usage", () => {
    const c = costLine({ perMinute: 0.01, perMessage: 0.0005 }, DEFAULT_FEES);
    expect(monthlyCostUsd({ voiceMinutes: 780, messages: 1000 }, c)).toBeCloseTo(780 * 0.09 + 1000 * 0.0035, 8);
    expect(monthlyCostUsd({ voiceMinutes: 0, messages: 0 }, c)).toBe(0);
  });
  it("converts dollars to dinar at the pegged rate", () => {
    expect(USD_TO_BHD).toBe(0.377);
    expect(toBhd(1)).toBeCloseTo(0.377, 10);
  });
});

describe("what the client pays", () => {
  it("spreads a package's fee over its credits", () => {
    expect(clientRatePerCredit([pkg()])).toBeCloseTo(199 / 2500, 10);
  });
  it("uses the prepaid price for pay as you go", () => {
    expect(clientRatePerCredit([payg()])).toBe(0.11);
  });
  it("takes the cheapest of several plans and ignores ended ones", () => {
    expect(clientRatePerCredit([pkg(), payg()])).toBeCloseTo(199 / 2500, 10);
    expect(clientRatePerCredit([pkg({ active: false }), payg()])).toBe(0.11);
    expect(clientRatePerCredit([pkg({ active: false })])).toBeNull();
    expect(clientRatePerCredit([])).toBeNull();
  });
  it("does not divide by zero for a package with no credits", () => {
    expect(clientRatePerCredit([pkg({ includedCredits: 0, pricePerCreditBhd: 0.09 })])).toBe(0.09);
  });
});

describe("margin", () => {
  const cost = costLine({ perMinute: 0.004, perMessage: 0.0002 }, DEFAULT_FEES); // about $0.084 a minute
  it("shows what we keep on a voice minute and a message", () => {
    const m = marginOf(0.0796, cost);
    expect(m.clientMinuteBhd).toBeCloseTo(0.0796, 10);
    expect(m.clientMessageBhd).toBeCloseTo(0.0796 / 20, 10);
    // cost 0.084 USD = 0.0317 BHD, so about 60% of 0.0796 is kept
    expect(m.voicePct).toBe(60);
    expect(m.textPct).toBe(Math.round(((0.0796 / 20 - 0.0032 * 0.377) / (0.0796 / 20)) * 100));
  });
  it("goes negative when the model costs more than the client pays", () => {
    const dear = costLine({ perMinute: 0.2, perMessage: 0.01 }, DEFAULT_FEES);
    expect(marginOf(0.0796, dear).voicePct).toBeLessThan(0);
  });
  it("is zero, not NaN, with no price", () => {
    expect(marginOf(0, cost)).toMatchObject({ voicePct: 0, textPct: 0 });
  });
  it("is green from 40%, amber from 15%, red below", () => {
    expect([marginTone(60), marginTone(40), marginTone(39), marginTone(15), marginTone(14), marginTone(-20)]).toEqual(["ok", "ok", "warn", "warn", "bad", "bad"]);
  });
});

describe("number formats", () => {
  it("shows small dollar amounts with enough digits", () => {
    expect(fmtUsd(0.0007)).toBe("$0.0007");
    expect(fmtUsd(0.084)).toBe("$0.084");
    expect(fmtUsd(12.3456)).toBe("$12.35");
  });
  it("writes dinar with three decimals", () => {
    expect(fmtBhd(0.0317)).toBe("BHD 0.032");
    expect(fmtBhd(109)).toBe("BHD 109.000");
  });
});
