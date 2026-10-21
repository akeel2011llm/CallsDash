import { headers } from "next/headers";
import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getAgent } from "@/lib/data";
import { Notice, PageHead } from "@/components/ui";
import { WidgetPreview } from "@/components/WidgetPreview";

export default async function WebsitePage() {
  const { tenant } = await requireClient();
  const { t } = await getT();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const snippet = `<script src="${proto}://${host}/widget.js" data-tenant="${tenant.slug}" async></script>`;
  const connected = Boolean((await getAgent(tenant.id)).elevenLabsAgentId);
  return (
    <>
      <PageHead title={t("website.title")} />
      <section className="card stack">
        <p className="muted">{t("website.help")}</p>
        <pre>{snippet}</pre>
        <div><strong>{t("website.domains")}:</strong> {tenant.allowedDomains.join(", ") || "–"}</div>
      </section>
      <section className="card stack">
        <h2>{t("website.preview")}</h2>
        {!connected && <Notice>{t("website.noAgent")}</Notice>}
        <WidgetPreview tenant={tenant.slug} />
      </section>
    </>
  );
}
