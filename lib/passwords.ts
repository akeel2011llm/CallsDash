import { randomInt } from "node:crypto";

/** No 0/O, 1/l/I: a temporary password is often read aloud or typed from a WhatsApp message. */
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A temporary password such as "Kx7m-Pq2w-Rt9n", 12 characters from a crypto-secure source. */
export function generatePassword(): string {
  const pick = () => ALPHABET[randomInt(ALPHABET.length)];
  const group = () => Array.from({ length: 4 }, pick).join("");
  return `${group()}-${group()}-${group()}`;
}

export const MIN_PASSWORD = 10;

/** Returns why a password is not acceptable, or null. Length matters most; the rest only stops the obvious. */
export function passwordProblem(pw: string): "short" | "weak" | null {
  if (pw.length < MIN_PASSWORD) return "short";
  if (new Set(pw).size < 5) return "weak";
  if (/^(password|12345|qwerty|callsdash)/i.test(pw)) return "weak";
  return null;
}
