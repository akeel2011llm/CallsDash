import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getAlerts, getTopUpRequests, listTenants } from "@/lib/data";
import { runBillingRemindersSoon } from "@/lib/billing-server";
import { systemText } from "@/lib/system-text";
import { BillingBanner } from "@/components/BillingBanner";
import { Shell } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const { t } = await getT();
  await runBillingRemindersSoon(); // at most every 6 hours: a missed daily timer never means a missed reminder
  const [alerts, requests, tenants] = await Promise.all([getAlerts(), getTopUpRequests(), listTenants()]);
  const open = alerts.filter((a) => !a.resolved).length;
  const names = new Map(tenants.map((c) => [c.id, c.name]));
  const reminders = alerts.filter((a) => !a.resolved && a.message.startsWith("Billing reminder:")).slice(0, 5)
    .map((a) => ({ key: a.id, text: `${names.get(a.tenantId) ?? ""}: ${systemText(a.message, t as (k: string, v?: Record<string, string | number>) => string)}` }));
  return (
    <Shell
      title="CallsDash"
      subtitle="Admin"
      nav={[
        { href: "/admin", label: t("nav.clients"), icon: "users", exact: true },
        { href: "/admin/users", label: t("nav.people"), icon: "key" },
        { href: "/admin/billing/clients", also: ["/admin/billing"], label: t("nav.billing"), icon: "wallet", badge: requests.length || undefined },
        { href: "/admin/alerts", label: t("nav.alerts"), icon: "bell", badge: open || undefined },
        { href: "/admin/settings", label: t("nav.platform"), icon: "gear" },
      ]}
    >
      <BillingBanner scope="admin" lines={reminders} href="/admin/billing/clients" labels={{ title: t("bc.banner.title"), close: t("bc.banner.close"), open: t("bc.banner.open") }} />
      {children}
    </Shell>
  );
}
