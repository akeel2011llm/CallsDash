import { describe, expect, it } from "vitest";
import { asciiDigits, normalizeCpr } from "@/lib/cpr";
import { seed } from "@/lib/seed";

describe("CPR numbers", () => {
  it("accepts 9 digits written with spaces, dashes, dots or Arabic digits", () => {
    expect(normalizeCpr("850123456")).toBe("850123456");
    expect(normalizeCpr(" 850 123 456 ")).toBe("850123456");
    expect(normalizeCpr("850-123-456")).toBe("850123456");
    expect(normalizeCpr("85.01.23456")).toBe("850123456");
    expect(normalizeCpr("٨٥٠١٢٣٤٥٦")).toBe("850123456");
    expect(normalizeCpr("۸۵۰۱۲۳۴۵۶")).toBe("850123456");
  });

  it("refuses anything that is not exactly 9 digits", () => {
    for (const v of ["", "85012345", "8501234567", "85012345x", "CPR 850123456", "+850123456", "000000000", "111111111", null, undefined]) expect(normalizeCpr(v)).toBeNull();
  });

  it("turns Arabic digits into ASCII and leaves everything else alone", () => {
    expect(asciiDigits("+973 ٣٩١٢ ٣٤٥٦")).toBe("+973 3912 3456");
  });

  it("gives every demo booking a valid CPR number", () => {
    const { bookings } = seed();
    expect(bookings.length).toBeGreaterThan(0);
    for (const b of bookings) expect(normalizeCpr(b.patientCpr)).toBe(b.patientCpr);
  });
});
