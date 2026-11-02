import { clientSections, requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { Shell, type NavItem } from "@/components/Shell";
import { getConversations, getStaffRequests, getWallet } from "@/lib/data";
import { needsAttention } from "@/lib/flags";
import { publicBranding } from "@/lib/brand-image";
import type { Section } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * The client portal's menu, in the order a front-desk person works (2026-11-02 rearrangement):
 * Today, then the daily work (Inbox, Bookings, Customers), then the business (Catalog, Assistant, Reports), then the
 * account (Billing, Settings). Sections a person may not open (lib/access.ts) are left out. On a phone the first four
 * items sit in the bottom bar and the rest are in the menu.
 */
export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const c = await requireClient();
  const { tenant, viewingAsAdmin } = c;
  const { t, locale } = await getT(tenant);
  const [w, requests, convs, sections] = await Promise.all([getWallet(tenant.id), getStaffRequests(tenant.id), getConversations(tenant.id), clientSections(c)]);
  const attention = convs.filter(needsAttention).length;
  const openRequests = requests.filter((r) => r.status === "open").length;
  const items: (NavItem & { section?: Section })[] = [
    { href: "/app", label: t("nav.today"), icon: "home", exact: true, tab: true },
    { section: "inbox", href: "/app/conversations", label: t("nav.inbox"), icon: "chat", tab: true, also: ["/app/attention", "/app/messages", "/app/recordings"], badge: attention + openRequests || undefined, group: t("nav.g.work") },
    { section: "bookings", href: "/app/bookings", label: t("nav.bookings"), icon: "check", tab: true, also: ["/app/calendar", "/app/doctors"] },
    { section: "customers", href: "/app/customers", label: t("nav.customers"), icon: "contact", tab: true },
    { section: "catalog", href: "/app/catalogue", label: t("nav.catalog"), short: t("nav.catalog.short"), icon: "tag", also: ["/app/data", "/app/tables"], group: t("nav.g.business") },
    { section: "assistant", href: "/app/assistant", label: t("nav.yourAssistant"), icon: "sliders", also: ["/app/knowledge", "/app/agent", "/app/voice", "/app/website"] },
    { section: "reports", href: "/app/reports", label: t("nav.reports"), icon: "chart" },
    { section: "billing", href: "/app/credits", label: t("credits.title"), icon: "wallet", badge: w.low ? "!" : undefined, group: t("nav.g.account") },
    { href: "/app/settings", label: t("nav.settings"), icon: "gear", also: ["/app/team"] },
  ];
  // keep each group heading on the first item still shown
  const nav: NavItem[] = [];
  let heading: string | undefined;
  for (const { section, ...n } of items) {
    if (n.group) heading = n.group;
    if (section && !sections.includes(section)) continue;
    nav.push({ ...n, group: heading });
    heading = undefined;
  }
  // the bottom bar: the first four items marked, filled up from the rest when a section is hidden
  const marked = nav.filter((n) => n.tab).length;
  for (const n of nav) if (!n.tab && marked < 4 && nav.filter((x) => x.tab).length < 4 && n.icon !== "gear") n.tab = true;
  return (
    <Shell
      title={locale === "ar" ? tenant.branding.displayNameAr : tenant.branding.displayName}
      subtitle={t("nav.portal")}
      branding={publicBranding(tenant)}
      viewingAs={viewingAsAdmin}
      nav={nav}
    >
      {children}
    </Shell>
  );
}
