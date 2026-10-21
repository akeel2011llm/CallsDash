import { requireDoctor } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { Shell } from "@/components/Shell";
import { publicBranding } from "@/lib/brand-image";

export const dynamic = "force-dynamic";

export default async function DoctorLayout({ children }: { children: React.ReactNode }) {
  const { tenant, doctor } = await requireDoctor();
  const { t, locale } = await getT();
  return (
    <Shell
      title={locale === "ar" ? tenant.branding.displayNameAr : tenant.branding.displayName}
      subtitle={doctor.name}
      branding={publicBranding(tenant)}
      nav={[
        { href: "/doctor", label: t("doctor.nav.today"), icon: "home", exact: true, tab: true, group: t("nav.g.overview") },
        { href: "/doctor/bookings", label: t("nav.bookings"), icon: "check", tab: true },
        { href: "/doctor/bookings/new", label: t("bookings.new"), icon: "calendar", tab: true },
      ]}
    >
      {children}
    </Shell>
  );
}
