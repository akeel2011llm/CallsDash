import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { Shell } from "@/components/Shell";
import { getConversations, getStaffRequests, getWallet } from "@/lib/data";
import { needsAttention } from "@/lib/flags";
import { publicBranding } from "@/lib/brand-image";

export const dynamic = "force-dynamic";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const { tenant, viewingAsAdmin } = await requireClient();
  const { t, locale } = await getT(tenant);
  const [w, requests, convs] = await Promise.all([getWallet(tenant.id), getStaffRequests(tenant.id), getConversations(tenant.id)]);
  const attention = convs.filter(needsAttention).length;
  const openRequests = requests.filter((r) => r.status === "open").length;
  return (
    <Shell
      title={locale === "ar" ? tenant.branding.displayNameAr : tenant.branding.displayName}
      subtitle={t("nav.portal")}
      branding={publicBranding(tenant)}
      viewingAs={viewingAsAdmin}
      // 9 menu items; grouped pages keep their own addresses and show tabs (route groups (inbox), (bookings), ... in this folder)
      nav={[
        { href: "/app", label: t("nav.home"), icon: "home", exact: true, tab: true },
        { href: "/app/conversations", label: t("nav.inbox"), icon: "chat", tab: true, also: ["/app/attention", "/app/messages"], badge: attention + openRequests || undefined, group: t("nav.g.work") },
        { href: "/app/bookings", label: t("nav.bookings"), icon: "check", tab: true, also: ["/app/calendar", "/app/doctors"] },
        { href: "/app/customers", label: t("nav.customers"), icon: "contact", tab: true },
        { href: "/app/reports", label: t("nav.reports"), icon: "chart" },
        { href: "/app/catalogue", label: t("nav.catalog"), short: t("nav.catalog.short"), icon: "tag", also: ["/app/data"], group: t("nav.g.receptionist") },
        { href: "/app/knowledge", label: t("nav.yourAssistant"), icon: "sliders", also: ["/app/agent", "/app/voice", "/app/website"] },
        { href: "/app/credits", label: t("nav.billing"), icon: "wallet", badge: w.low ? "!" : undefined, group: t("nav.g.account") },
        { href: "/app/settings", label: t("nav.settings"), icon: "gear", also: ["/app/team"] },
      ]}
    >
      {children}
    </Shell>
  );
}
