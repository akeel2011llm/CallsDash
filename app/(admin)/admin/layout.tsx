import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getAlerts, getTopUpRequests } from "@/lib/data";
import { Shell } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const { t } = await getT();
  const [alerts, requests] = await Promise.all([getAlerts(), getTopUpRequests()]);
  const open = alerts.filter((a) => !a.resolved).length;
  return (
    <Shell
      title="CallsDash"
      subtitle="Admin"
      nav={[
        { href: "/admin", label: t("nav.clients"), icon: "users", exact: true },
        { href: "/admin/users", label: t("nav.people"), icon: "key" },
        { href: "/admin/billing/packages", also: ["/admin/billing"], label: t("nav.billing"), icon: "wallet", badge: requests.length || undefined },
        { href: "/admin/alerts", label: t("nav.alerts"), icon: "bell", badge: open || undefined },
        { href: "/admin/settings", label: t("nav.platform"), icon: "gear" },
      ]}
    >
      {children}
    </Shell>
  );
}
