import { BUSINESS_TYPES, businessOf, type BusinessProfile } from "@/lib/business-types";
import type { Key } from "@/lib/i18n";

/**
 * The business type inputs, shared by New client and the client page. `t` must be the plain texts (getT() without a client),
 * or the option "Clinic (doctors, patients)" would itself be reworded for a salon.
 */
export function BusinessFields({ t, business }: { t: (k: Key) => string; business?: BusinessProfile }) {
  const b = businessOf(business ? { business } : null);
  const w = b.words ?? {};
  return (
    <>
      <label>{t("biz.type")}
        <select name="businessType" defaultValue={b.type}>
          {BUSINESS_TYPES.map((x) => <option key={x} value={x}>{t(`biz.type.${x}` as Key)}</option>)}
        </select>
      </label>
      <input type="hidden" name="schedulingShown" value="1" />
      <label className="inline"><input type="checkbox" name="staffScheduling" defaultChecked={b.staffScheduling} />{t("biz.scheduling")}</label>
      <small className="muted">{t("biz.scheduling.help")}</small>
      <details open={b.type === "custom"}>
        <summary>{t("biz.words")}</summary>
        <div className="grid two" style={{ marginBlockStart: ".5rem" }}>
          <label>{t("biz.words.one")}<input name="staffOne" defaultValue={w.staffOne ?? ""} maxLength={40} dir="ltr" /></label>
          <label>{t("biz.words.many")}<input name="staffMany" defaultValue={w.staffMany ?? ""} maxLength={40} dir="ltr" /></label>
          <label>{t("biz.words.oneAr")}<input name="staffOneAr" defaultValue={w.staffOneAr ?? ""} maxLength={40} dir="rtl" /></label>
          <label>{t("biz.words.manyAr")}<input name="staffManyAr" defaultValue={w.staffManyAr ?? ""} maxLength={40} dir="rtl" /></label>
        </div>
      </details>
    </>
  );
}
