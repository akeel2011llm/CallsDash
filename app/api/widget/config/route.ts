import { NextResponse } from "next/server";
import { dictionaries } from "@/lib/i18n";
import { getAgent, getTenant, getWallet, listTenants } from "@/lib/data";
import { agentVariables } from "@/lib/agent-context";

export const dynamic = "force-dynamic";

function hostOf(url: string | null) {
  try {
    return url ? new URL(url).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("tenant") ?? "";
  const tenant = (await listTenants()).find((t) => t.slug === slug);
  const origin = req.headers.get("origin");
  const callerHost = hostOf(origin) ?? hostOf(req.headers.get("referer"));
  const ownHost = hostOf(`http://${req.headers.get("host") ?? ""}`);
  // Same-origin previews and non-browser callers carry no origin; cross-origin pages must be on the client's allow-list.
  const allowed = !tenant ? false : !callerHost || callerHost === ownHost || tenant.allowedDomains.some((d) => callerHost === d || callerHost.endsWith(`.${d}`));
  if (!tenant || !allowed) return NextResponse.json({ error: "not allowed" }, { status: tenant ? 403 : 404 });

  const wallet = await getWallet(tenant.id);
  const paused = tenant.status === "suspended" || (wallet.balance <= 0 && tenant.zeroBalancePolicy === "pause");
  const body = {
    name: { en: tenant.branding.displayName, ar: tenant.branding.displayNameAr },
    color: tenant.branding.primaryColor,
    agentId: (await getAgent(tenant.id)).elevenLabsAgentId || null,
    paused,
    dynamicVariables: agentVariables(tenant, new Date(), { channel: "website" }),
    strings: {
      en: Object.fromEntries(Object.entries(dictionaries.en).filter(([k]) => k.startsWith("widget."))),
      ar: Object.fromEntries(Object.entries(dictionaries.ar).filter(([k]) => k.startsWith("widget."))),
    },
  };
  return NextResponse.json(body, {
    headers: { "Access-Control-Allow-Origin": origin ?? "*", Vary: "Origin", "Cache-Control": "no-store" },
  });
}
