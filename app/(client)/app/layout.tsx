import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { Shell } from "@/components/Shell";
import { getWallet } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const { tenant, viewingAsAdmin } = await requireClient();
  const { t, locale } = await getT();
  const w = getWallet(tenant.id);
  return (
    <Shell
      title={locale === "ar" ? tenant.branding.displayNameAr : tenant.branding.displayName}
      subtitle="CallsDash"
      color={tenant.branding.primaryColor}
      viewingAs={viewingAsAdmin}
      nav={[
        { href: "/app", label: t("nav.home"), exact: true },
        { href: "/app/conversations", label: t("nav.conversations") },
        { href: "/app/bookings", label: t("nav.bookings") },
        { href: "/app/calendar", label: t("nav.calendar") },
        { href: "/app/knowledge", label: t("nav.knowledge") },
        { href: "/app/agent", label: t("nav.agent") },
        { href: "/app/voice", label: t("nav.voice") },
        { href: "/app/website", label: t("nav.website") },
        { href: "/app/credits", label: t("nav.credits"), badge: w.low ? "!" : undefined },
      ]}
    >
      {children}
    </Shell>
  );
}
