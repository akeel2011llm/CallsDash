import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getAlerts } from "@/lib/store";
import { Shell } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const { t } = await getT();
  const open = getAlerts().filter((a) => !a.resolved).length;
  return (
    <Shell
      title="CallsDash"
      subtitle="Admin"
      nav={[
        { href: "/admin", label: t("nav.clients"), exact: true },
        { href: "/admin/usage", label: t("nav.usage") },
        { href: "/admin/alerts", label: t("nav.alerts"), badge: open || undefined },
      ]}
    >
      {children}
    </Shell>
  );
}
