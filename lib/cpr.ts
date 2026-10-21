/**
 * Bahrain's CPR number (Central Population Registry): the 9-digit personal number on every Bahraini ID card. The
 * clinic asks for it to book, and a patient gives it again to look up, move or cancel a booking.
 */
export const CPR_DIGITS = 9;

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits as ASCII, so a number typed on an Arabic keyboard or passed by the agent in Arabic still reads. */
export const asciiDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));

/** The 9 digits of a CPR number written with or without spaces, dashes or dots, or null when it is not 9 digits. */
export function normalizeCpr(v: string | null | undefined): string | null {
  const digits = asciiDigits(String(v ?? "")).replace(/[\s.\-–]/g, "");
  return new RegExp(`^\\d{${CPR_DIGITS}}$`).test(digits) ? digits : null;
}
