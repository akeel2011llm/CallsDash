import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { Shell } from "@/components/Shell";
import { getConversations, getStaffRequests, getWallet } from "@/lib/data";
import { needsAttention } from "@/lib/flags";
import { publicBranding } from "@/lib/brand-image";

export const dynamic = "force-dynamic";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const { tenant, viewingAsAdmin, staffRole } = await requireClient();
  const { t, locale } = await getT();
  const [w, requests, convs] = await Promise.all([getWallet(tenant.id), getStaffRequests(tenant.id), getConversations(tenant.id)]);
  const attention = convs.filter(needsAttention).length;
  const openRequests = requests.filter((r) => r.status === "open").length;
  return (
    <Shell
      title={locale === "ar" ? tenant.branding.displayNameAr : tenant.branding.displayName}
      subtitle={t("nav.portal")}
      branding={publicBranding(tenant)}
      viewingAs={viewingAsAdmin}
      nav={[
        { href: "/app", label: t("nav.home"), icon: "home", exact: true, tab: true, group: t("nav.g.overview") },
        { href: "/app/reports", label: t("nav.reports"), icon: "chart" },
        { href: "/app/conversations", label: t("nav.conversations"), short: t("nav.conversations.short"), icon: "chat", tab: true, group: t("nav.g.calls") },
        { href: "/app/attention", label: t("nav.attention"), short: t("nav.attention.short"), icon: "flag", tab: true, badge: attention || undefined },
        { href: "/app/messages", label: t("nav.messages"), icon: "inbox", badge: openRequests || undefined },
        { href: "/app/bookings", label: t("nav.bookings"), icon: "check", tab: true },
        { href: "/app/calendar", label: t("nav.calendar"), icon: "calendar" },
        { href: "/app/knowledge", label: t("nav.knowledge"), icon: "book", group: t("nav.g.receptionist") },
        { href: "/app/agent", label: t("nav.agent"), icon: "sliders" },
        { href: "/app/voice", label: t("nav.voice"), icon: "mic" },
        { href: "/app/website", label: t("nav.website"), icon: "globe" },
        { href: "/app/credits", label: t("nav.credits"), icon: "wallet", badge: w.low ? "!" : undefined, group: t("nav.g.account") },
        ...(staffRole === "manager" ? [{ href: "/app/doctors", label: t("nav.doctors"), icon: "user" }, { href: "/app/team", label: t("nav.team"), icon: "users" }] : []),
        { href: "/app/settings", label: t("nav.settings"), icon: "gear" },
      ]}
    >
      {children}
    </Shell>
  );
}
