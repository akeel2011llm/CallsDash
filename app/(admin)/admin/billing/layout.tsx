import { getT } from "@/lib/i18n";
import { getTopUpRequests } from "@/lib/data";
import { Tabs } from "@/components/Tabs";

/** The Billing hub (docs/reorganization.md, milestone 4): packages, usage and margin, and every client's top-up requests. */
export default async function BillingHub({ children }: { children: React.ReactNode }) {
  const [{ t }, requests] = await Promise.all([getT(), getTopUpRequests()]);
  return (
    <>
      <Tabs
        label={t("billing.tabs")}
        items={[
          { href: "/admin/billing/packages", label: t("billing.packages") },
          { href: "/admin/billing/usage", label: t("billing.usage") },
          { href: "/admin/billing/requests", label: t("billing.requests"), badge: requests.length || undefined },
        ]}
      />
      {children}
    </>
  );
}
