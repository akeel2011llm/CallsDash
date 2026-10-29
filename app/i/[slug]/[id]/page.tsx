import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { appUrl } from "@/lib/app-url";
import { getDoctors, getItem, listTenants } from "@/lib/data";
import { itemImageUrl } from "@/lib/items";
import { themeVars } from "@/lib/theme";
import type { Locale } from "@/lib/types";

export const dynamic = "force-dynamic";

async function load(slug: string, id: string, lang?: string) {
  const tenant = (await listTenants()).find((x) => x.slug === slug);
  if (!tenant) return null;
  const locale: Locale = lang === "ar" ? "ar" : "en";
  const ar = locale === "ar";
  const clinic = (ar ? tenant.branding.displayNameAr : tenant.branding.displayName) || tenant.name;
  const found = await getItem(tenant.id, id);
  if (found) {
    if (!found.active) return null;
    return { tenant, item: found, locale, clinic, name: (ar && found.nameAr) || found.name, details: (ar && found.detailsAr) || found.details };
  }
  // a doctor's page: the photo, the name and the specialty, shown the same way
  const doctor = (await getDoctors(tenant.id)).find((x) => x.id === id);
  if (!doctor || doctor.active === false) return null;
  const item = { id: doctor.id, name: doctor.name, details: doctor.specialty, price: undefined, hasImage: Boolean(doctor.photoAt), updatedAt: doctor.photoAt ?? "" };
  return { tenant, item, locale, clinic, name: doctor.name, details: doctor.specialty };
}

/** The tags a chat app reads to show a picture, the name and a line of text under the link. */
export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ lang?: string }> }): Promise<Metadata> {
  const [{ slug, id }, sp] = await Promise.all([params, searchParams]);
  const p = await load(slug, id, sp.lang);
  if (!p) return { title: "Not found", robots: { index: false } };
  const origin = await appUrl();
  const image = p.item.hasImage ? itemImageUrl(origin, slug, p.item) : undefined;
  const description = [p.item.price, p.details].filter(Boolean).join(" - ").slice(0, 200);
  return {
    title: `${p.name} - ${p.clinic}`,
    description,
    robots: { index: false, follow: false }, // a link shared in a chat, not something for search engines
    openGraph: { title: p.name, description, siteName: p.clinic, type: "website", ...(image ? { images: [{ url: image }] } : {}) },
    twitter: { card: image ? "summary_large_image" : "summary", title: p.name, description, ...(image ? { images: [image] } : {}) },
  };
}

/** A public page for one catalogue item: the photo, the name, the price and the details. Opened from a link in a WhatsApp or Instagram chat. */
export default async function ItemPublicPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ lang?: string }> }) {
  const [{ slug, id }, sp] = await Promise.all([params, searchParams]);
  const p = await load(slug, id, sp.lang);
  if (!p) notFound();
  const rtl = p.locale === "ar";
  return (
    <main dir={rtl ? "rtl" : "ltr"} lang={p.locale} style={{ ...themeVars(p.tenant.branding), maxInlineSize: 560, marginInline: "auto", padding: "1rem", display: "grid", gap: "1rem" }}>
      <small style={{ opacity: 0.7 }}>{p.clinic}</small>
      {p.item.hasImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={itemImageUrl("", slug, p.item)} alt={p.name} style={{ inlineSize: "100%", maxBlockSize: "70vh", objectFit: "cover", borderRadius: 14 }} />
      )}
      <h1 style={{ margin: 0 }}>{p.name}</h1>
      {p.item.price && <strong>{p.item.price}</strong>}
      {p.details && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{p.details}</p>}
    </main>
  );
}
