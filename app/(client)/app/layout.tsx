import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { Shell } from "@/components/Shell";
import { getConversations, getStaffRequests, getWallet } from "@/lib/data";
import { needsAttention } from "@/lib/flags";

export const dynamic = "force-dynamic";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const { tenant, viewingAsAdmin } = await requireClient();
  const { t, locale } = await getT();
  const [w, requests, convs] = await Promise.all([getWallet(tenant.id), getStaffRequests(tenant.id), getConversations(tenant.id)]);
  const attention = convs.filter(needsAttention).length;
  const openRequests = requests.filter((r) => r.status === "open").length;
  return (
    <Shell
      title={locale === "ar" ? tenant.branding.displayNameAr : tenant.branding.displayName}
      subtitle={t("nav.portal")}
      branding={tenant.branding}
      viewingAs={viewingAsAdmin}
      nav={[
        { href: "/app", label: t("nav.home"), icon: "home", exact: true, group: t("nav.g.overview") },
        { href: "/app/reports", label: t("nav.reports"), icon: "chart" },
        { href: "/app/conversations", label: t("nav.conversations"), icon: "chat", group: t("nav.g.calls") },
        { href: "/app/attention", label: t("nav.attention"), icon: "flag", badge: attention || undefined },
        { href: "/app/messages", label: t("nav.messages"), icon: "inbox", badge: openRequests || undefined },
        { href: "/app/bookings", label: t("nav.bookings"), icon: "check" },
        { href: "/app/calendar", label: t("nav.calendar"), icon: "calendar" },
        { href: "/app/knowledge", label: t("nav.knowledge"), icon: "book", group: t("nav.g.receptionist") },
        { href: "/app/agent", label: t("nav.agent"), icon: "sliders" },
        { href: "/app/voice", label: t("nav.voice"), icon: "mic" },
        { href: "/app/website", label: t("nav.website"), icon: "globe" },
        { href: "/app/credits", label: t("nav.credits"), icon: "wallet", badge: w.low ? "!" : undefined, group: t("nav.g.account") },
      ]}
    >
      {children}
    </Shell>
  );
}
