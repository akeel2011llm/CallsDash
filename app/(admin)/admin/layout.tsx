import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getAlerts } from "@/lib/data";
import { Shell } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const { t } = await getT();
  const open = (await getAlerts()).filter((a) => !a.resolved).length;
  return (
    <Shell
      title="CallsDash"
      subtitle="Admin"
      nav={[
        { href: "/admin", label: t("nav.clients"), icon: "users", exact: true },
        { href: "/admin/users", label: t("nav.users"), icon: "key" },
        { href: "/admin/packages", label: t("nav.packages"), icon: "package" },
        { href: "/admin/usage", label: t("nav.usage"), icon: "usage" },
        { href: "/admin/alerts", label: t("nav.alerts"), icon: "bell", badge: open || undefined },
      ]}
    >
      {children}
    </Shell>
  );
}
