import { getT } from "@/lib/i18n";
import { buildInfo } from "@/lib/build-info";

/** Alpha-stage strip: the update number this copy of the app was built from. Shown to the owner only. */
export async function BuildBadge() {
  const { t } = await getT();
  const b = buildInfo();
  return (
    <div className="build-badge" role="status">
      <strong>{t("build.alpha")}</strong>
      <span>{b.pr ? t("build.update").replace("{n}", b.pr) : t("build.unknown")}</span>
      {b.title && <span className="muted" dir="auto">{b.title}</span>}
      {b.sha && <span className="muted" dir="ltr">{b.sha}</span>}
    </div>
  );
}
