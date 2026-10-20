import type { Tenant } from "./types";

/** Names compare case-insensitively with whitespace collapsed ("Al  Noor Clinic " = "al noor clinic"). */
export const nameKey = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** Website addresses compare by host only: protocol, "www.", port, path and query are ignored. */
export function domainKey(s: string): string {
  let v = s.trim().toLowerCase();
  if (!v) return "";
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#]/)[0].replace(/^[^@]*@/, "").replace(/:\d+$/, "").replace(/^www\./, "");
  return v.replace(/\.$/, "");
}

/** Every website host a client owns: the branding domain plus its allowed widget domains. */
export const domainKeysOf = (t: Pick<Tenant, "branding" | "allowedDomains">): string[] =>
  [...new Set([t.branding.domain ?? "", ...t.allowedDomains].map(domainKey).filter(Boolean))];

/**
 * Returns which field clashes with another client, if any. `others` must be every client except the one being saved.
 * Used inside the same transaction that writes, so two quick submits cannot both pass.
 */
export function findDuplicate(
  others: Pick<Tenant, "name" | "branding" | "allowedDomains">[],
  candidate: { name?: string; domains?: string[] },
): "name" | "domain" | null {
  const nk = candidate.name !== undefined ? nameKey(candidate.name) : "";
  const dks = new Set((candidate.domains ?? []).map(domainKey).filter(Boolean));
  for (const o of others) {
    if (nk && (nameKey(o.name) === nk || nameKey(o.branding.displayName) === nk)) return "name";
    if (dks.size && domainKeysOf(o).some((d) => dks.has(d))) return "domain";
  }
  return null;
}
