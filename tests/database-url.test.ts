import { describe, expect, it } from "vitest";
import { normalizeDatabaseUrl as n } from "@/lib/data/database-url";

const host = "aws-0-eu.pooler.supabase.com:6543/postgres";
describe("normalizeDatabaseUrl", () => {
  it("leaves a good URL alone", () => expect(n(`postgresql://postgres.abc:Pass123@${host}`)).toBe(`postgresql://postgres.abc:Pass123@${host}`));
  it("removes quotes and whitespace", () => expect(n(` "postgresql://postgres.abc:Pass123@${host}"\n`)).toBe(`postgresql://postgres.abc:Pass123@${host}`));
  it("removes the placeholder brackets around the password", () => expect(n(`postgresql://postgres.abc:[Pass123]@${host}`)).toBe(`postgresql://postgres.abc:Pass123@${host}`));
  it("encodes symbols in the password, including @", () => {
    const out = n(`postgresql://postgres.abc:p@ss#w/rd:1@${host}`);
    expect(out).toBe(`postgresql://postgres.abc:p%40ss%23w%2Frd%3A1@${host}`);
    expect(decodeURIComponent(new URL(out).password)).toBe("p@ss#w/rd:1");
  });
  it("does not double-encode an already encoded password", () => expect(n(`postgresql://postgres.abc:p%40ss@${host}`)).toBe(`postgresql://postgres.abc:p%40ss@${host}`));
  it("handles a literal percent sign", () => expect(new URL(n(`postgresql://postgres.abc:50%off@${host}`)).password).toBe("50%25off"));
});
