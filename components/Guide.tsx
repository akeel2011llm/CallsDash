import type { ReactNode } from "react";
import { getSession } from "@/lib/auth";
import { getSetting } from "@/lib/data";
import { getT } from "@/lib/i18n";
import { GUIDES, guideOwnerKey, readHidden, type GuideId } from "@/lib/guides";
import { hideGuideAction } from "@/lib/guide-actions";

/**
 * A setup guide or a list of precautions. It starts folded (a person opens it when they want it), has an x that hides it for
 * that person, and can be brought back in the account settings. `plain` drops the card frame for a guide inside another card.
 */
export async function Guide({ id, plain, children }: { id: GuideId; plain?: boolean; children: ReactNode }) {
  const [s, { t }] = await Promise.all([getSession(), getT()]);
  if (s && readHidden(await getSetting(guideOwnerKey(s))).includes(id)) return null;
  return (
    <section className={`guide${plain ? " plain" : " card"}`} aria-label={t(GUIDES[id])}>
      <details>
        <summary>{t(GUIDES[id])}</summary>
        <div className="stack" style={{ marginBlockStart: ".75rem" }}>{children}</div>
      </details>
      <form action={hideGuideAction}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" className="btn small ghost guide-x" aria-label={t("guide.hide")} title={t("guide.hide")}>×</button>
      </form>
    </section>
  );
}
