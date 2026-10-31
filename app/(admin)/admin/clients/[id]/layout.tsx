import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { getTenant, getTopUpRequests } from "@/lib/data";
import { viewAsClient } from "@/lib/actions";
import { Tabs } from "@/components/Tabs";
import { Badge } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * The client workspace (docs/reorganization.md, milestone 2): every screen about one client sits under one header with one
 * row of tabs, instead of a long page plus a row of buttons. Each tab is its own address.
 */
export default async function ClientWorkspace({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  const tenant = await getTenant(id);
  if (!tenant) notFound();
  const [{ t, locale }, requests] = await Promise.all([getT(tenant), getTopUpRequests()]);
  const asked = requests.filter((r) => r.tenantId === id).length;
  const base = `/admin/clients/${id}`;
  const name = locale === "ar" ? tenant.branding.displayNameAr || tenant.name : tenant.name;
  const tone = tenant.status === "live" ? "ok" : tenant.status === "suspended" ? "warn" : "bad";
  return (
    <>
      <div className="ws-head">
        <div className="ws-title">
          <Link href="/admin" className="muted ws-back">{t("ws.back")}</Link>
          <div className="row" style={{ gap: ".5rem", flexWrap: "wrap" }}>
            <strong className="ws-name">{name}</strong>
            <Badge tone={tone}>{t(`status.${tenant.status}` as "status.live")}</Badge>
          </div>
        </div>
        <form action={viewAsClient}><input type="hidden" name="tenantId" value={id} /><SubmitButton className="btn">{t("admin.viewAs")}</SubmitButton></form>
      </div>
      <Tabs
        label={t("ws.tabs")}
        items={[
          { href: base, label: t("ws.overview"), exact: true },
          { href: `${base}/setup`, label: t("ws.setup") },
          { href: `${base}/business`, label: t("ws.business") },
          { href: `${base}/people`, label: t("ws.people") },
          { href: `${base}/data`, label: t("ws.data") },
          { href: `${base}/assistant`, label: t("ws.assistant") },
          { href: `${base}/channels`, label: t("ws.channels") },
          { href: `${base}/billing`, label: t("ws.billing"), badge: asked || undefined },
          { href: `${base}/activity`, label: t("ws.activity") },
        ]}
      />
      {children}
    </>
  );
}
