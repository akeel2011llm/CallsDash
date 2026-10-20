/**
 * Cleans up a pasted DATABASE_URL: surrounding quotes or spaces, the `[YOUR-PASSWORD]` square brackets Supabase shows,
 * and passwords containing symbols (@ # / : ? %) that were not URL-encoded. Returns the URL unchanged when it is already fine.
 */
export function normalizeDatabaseUrl(input: string): string {
  let raw = input.trim().replace(/^["']+|["']+$/g, "").trim();
  const m = /^(postgres(?:ql)?:\/\/)([^:/?#@]+):(.*)@([^@/?#]+(?::\d+)?(?:\/[^\s]*)?)$/s.exec(raw);
  if (!m) return raw;
  const [, scheme, user, rawPassword, rest] = m;
  let password = rawPassword;
  if (/^\[.*\]$/s.test(password)) password = password.slice(1, -1);
  let decoded = password;
  try { decoded = decodeURIComponent(password); } catch { /* not encoded: take it literally */ }
  raw = `${scheme}${user}:${encodeURIComponent(decoded.trim())}@${rest}`;
  return raw;
}
