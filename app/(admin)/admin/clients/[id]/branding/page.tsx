import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getTenant } from "@/lib/data";
import { adminBrandingAction } from "@/lib/actions";
import { publicBranding } from "@/lib/brand-image";
import { FONT_STYLES, PATTERN_STYLES, RADIUS_STYLES, SIDEBAR_STYLES, isHex, patternOf } from "@/lib/theme";
import { Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { BrandingPreview } from "@/components/BrandingPreview";

export default async function BrandingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; logo?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const tenant = await getTenant(id);
  if (!tenant) notFound();
  const { t } = await getT();
  const b = tenant.branding;
  const primary = isHex(b.primaryColor) ? b.primaryColor : "#0e7c86";
  const choices = <K extends string>(name: string, list: readonly K[], current: K, label: (k: K) => string) => (
    <div className="radio-cards">
      {list.map((k) => <label key={k}><input type="radio" name={name} value={k} defaultChecked={k === current} />{label(k)}</label>)}
    </div>
  );
  return (
    <>
      <PageHead
        title={`${t("brand.title")}: ${tenant.name}`}
        subtitle={t("brand.help")}
        actions={
          <>
            <Link className="btn ghost" href={`/admin/clients/${id}`}>{t("common.back")}</Link>
            <a className="btn ghost" href={`/login?c=${encodeURIComponent(tenant.slug)}`} target="_blank" rel="noreferrer">{t("brand.loginLink")}</a>
          </>
        }
      />
      {sp.saved && <Notice tone="ok">{t("brand.saved")}</Notice>}
      {sp.logo === "bad" && <Notice tone="warn">{t("brand.err.logo")}</Notice>}
      <div className="studio">
        <form id="brand-form" action={adminBrandingAction} className="stack">
          <input type="hidden" name="tenantId" value={id} />
          <section className="card stack">
            <h2>{t("brand.identity")}</h2>
            <label>{t("admin.displayName")}<input name="displayName" defaultValue={b.displayName} maxLength={120} /></label>
            <label>{t("admin.displayNameAr")}<input name="displayNameAr" defaultValue={b.displayNameAr} dir="rtl" maxLength={120} /></label>
            <label>{t("brand.logo")}
              <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" />
              <small className="muted">{t("brand.logo.help")}</small>
            </label>
            {b.logoUrl && <label className="inline"><input type="checkbox" name="removeLogo" />{t("brand.logo.remove")}</label>}
            <label>{t("brand.cover")}
              <input type="file" name="cover" accept="image/png,image/jpeg,image/webp,image/svg+xml" />
              <small className="muted">{t("brand.cover.help")}</small>
            </label>
            {b.coverUrl && <label className="inline"><input type="checkbox" name="removeCover" />{t("brand.cover.remove")}</label>}
          </section>

          <section className="card stack">
            <h2>{t("brand.colors")}</h2>
            <div className="grid two" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <label>{t("brand.primary")}<input type="color" name="primaryColor" defaultValue={primary} /></label>
              <label>{t("brand.accent")}<input type="color" name="accentColor" defaultValue={isHex(b.accentColor) ? b.accentColor : primary} /></label>
            </div>
          </section>

          <section className="card stack">
            <h2>{t("brand.layout")}</h2>
            <div className="stack"><strong>{t("brand.sidebar")}</strong>{choices("sidebar", SIDEBAR_STYLES, b.sidebar ?? "light", (k) => t(`brand.sidebar.${k}` as "brand.sidebar.light"))}</div>
            <div className="stack"><strong>{t("brand.radius")}</strong>{choices("radius", RADIUS_STYLES, b.radius ?? "soft", (k) => t(`brand.radius.${k}` as "brand.radius.soft"))}</div>
            <div className="stack"><strong>{t("brand.pattern")}</strong>{choices("pattern", PATTERN_STYLES, patternOf(b), (k) => t(`brand.pattern.${k}` as "brand.pattern.waves"))}</div>
            <div className="stack"><strong>{t("brand.font")}</strong>{choices("font", FONT_STYLES, b.font ?? "modern", (k) => t(`brand.font.${k}` as "brand.font.modern"))}</div>
          </section>

          <section className="card stack">
            <h2>{t("brand.wording")}</h2>
            <label>{t("brand.welcome")}<input name="welcome" defaultValue={b.welcome ?? ""} maxLength={240} /></label>
            <label>{t("brand.welcomeAr")}<input name="welcomeAr" defaultValue={b.welcomeAr ?? ""} dir="rtl" maxLength={240} /></label>
            <label>{t("brand.tagline")}<input name="tagline" defaultValue={b.tagline ?? ""} maxLength={160} /></label>
            <label>{t("brand.taglineAr")}<input name="taglineAr" defaultValue={b.taglineAr ?? ""} dir="rtl" maxLength={160} /></label>
          </section>

          <section className="card stack">
            <h2>{t("brand.support")}</h2>
            <label>{t("brand.phone")}<input name="supportPhone" defaultValue={b.supportPhone ?? ""} dir="ltr" maxLength={40} /></label>
            <label>{t("brand.email")}<input name="supportEmail" type="email" defaultValue={b.supportEmail ?? ""} dir="ltr" maxLength={120} /></label>
            <label>{t("brand.whatsapp")}<input name="supportWhatsapp" defaultValue={b.supportWhatsapp ?? ""} dir="ltr" maxLength={40} /></label>
          </section>

          <section className="card stack">
            <h2>{t("brand.reports")}</h2>
            <label>{t("brand.reportFooter")}<input name="reportFooter" defaultValue={b.reportFooter ?? ""} maxLength={200} /></label>
            <label className="inline"><input type="checkbox" name="hidePoweredBy" defaultChecked={Boolean(b.hidePoweredBy)} />{t("brand.hidePowered")}</label>
          </section>

          <div><SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton></div>
        </form>

        <aside className="sticky card stack">
          <h2>{t("brand.preview")}</h2>
          <BrandingPreview formId="brand-form" initial={publicBranding(tenant)} words={{ title: t("home.greeting"), body: t("brand.sample.body"), nav: t("brand.sample.nav"), stat: t("home.conversations") }} />
        </aside>
      </div>
    </>
  );
}
