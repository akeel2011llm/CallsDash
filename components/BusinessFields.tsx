import { BUSINESS_TYPES, MAX_ROLES, VOCAB, businessOf, rolesOf, type BusinessProfile, type WordKey } from "@/lib/business-types";
import type { Key } from "@/lib/i18n";

/**
 * The business inputs, shared by New client and the client's Business tab: the type (a starting point only), the client's own
 * words in English and Arabic, and the roles of the people who take bookings (Doctor, Nurse, Stylist...). `t` must be the plain
 * texts (getT() without a client), or the option "Clinic (doctors, patients)" would itself be reworded for a salon.
 */
export function BusinessFields({ t, business }: { t: (k: Key) => string; business?: BusinessProfile }) {
  const b = businessOf(business ? { business } : null);
  const w = b.words ?? {};
  const base = VOCAB[b.type];
  const roles = business ? rolesOf({ business }) : [];
  const lines = [...roles, ...Array.from({ length: Math.min(3, MAX_ROLES - roles.length) }, () => null)];
  const word = (k: WordKey, ph: string, ar: boolean) => (
    <label key={k}>{t(`biz.w.${k}` as Key)}<input name={k} defaultValue={w[k] ?? ""} placeholder={ph} maxLength={40} dir={ar ? "rtl" : "ltr"} /></label>
  );
  return (
    <>
      <label>{t("biz.type")}
        <select name="businessType" defaultValue={b.type}>
          {BUSINESS_TYPES.map((x) => <option key={x} value={x}>{t(`biz.type.${x}` as Key)}</option>)}
        </select>
      </label>
      <small className="muted">{t("biz.type.help")}</small>
      <input type="hidden" name="schedulingShown" value="1" />
      <label className="inline"><input type="checkbox" name="staffScheduling" defaultChecked={b.staffScheduling} />{t("biz.scheduling")}</label>
      <small className="muted">{t("biz.scheduling.help")}</small>

      <details open={Boolean(business?.roles?.length)}>
        <summary>{t("biz.roles")}</summary>
        <div className="stack" style={{ marginBlockStart: ".5rem" }}>
          <small className="muted">{t("biz.roles.help")}</small>
          <input type="hidden" name="roleCount" value={lines.length} />
          {lines.map((r, i) => (
            <fieldset key={r?.key ?? `new${i}`} className="col-line stack" style={{ margin: 0 }}>
              <legend className="muted">{r ? `${t("biz.role")} ${i + 1}` : t("biz.role.new")}</legend>
              {r && <input type="hidden" name={`role${i}_key`} value={r.key} />}
              <div className="form-cols">
                <label>{t("biz.role.one")}<input name={`role${i}_one`} defaultValue={r?.one ?? ""} maxLength={40} placeholder={i === 0 ? "Doctor" : i === 1 ? "Nurse" : "Stylist"} dir="ltr" /></label>
                <label>{t("biz.role.many")}<input name={`role${i}_many`} defaultValue={r?.many ?? ""} maxLength={40} placeholder={i === 0 ? "Doctors" : i === 1 ? "Nurses" : "Stylists"} dir="ltr" /></label>
                <label>{t("biz.role.oneAr")}<input name={`role${i}_oneAr`} defaultValue={r?.oneAr ?? ""} maxLength={40} placeholder={i === 0 ? "طبيب" : i === 1 ? "ممرض" : "أخصائي تجميل"} dir="rtl" /></label>
                <label>{t("biz.role.manyAr")}<input name={`role${i}_manyAr`} defaultValue={r?.manyAr ?? ""} maxLength={40} placeholder={i === 0 ? "أطباء" : i === 1 ? "ممرضون" : "أخصائيو تجميل"} dir="rtl" /></label>
              </div>
              {r && roles.length > 1 && <label className="inline"><input type="checkbox" name={`role${i}_remove`} />{t("biz.role.remove")}</label>}
            </fieldset>
          ))}
          <small className="muted">{t("biz.roles.more")}</small>
        </div>
      </details>

      <details open={Boolean(Object.keys(w).length)}>
        <summary>{t("biz.words")}</summary>
        <div className="stack" style={{ marginBlockStart: ".5rem" }}>
          <small className="muted">{t("biz.words.help")}</small>
          <div className="form-cols">
            {word("staffOne", base.en.staffOne, false)}{word("staffMany", base.en.staffMany, false)}
            {word("staffOneAr", base.ar.staffOne, true)}{word("staffManyAr", base.ar.staffMany, true)}
            {word("customerOne", base.en.customerOne, false)}{word("customerMany", base.en.customerMany, false)}
            {word("customerOneAr", base.ar.customerOne, true)}{word("customerManyAr", base.ar.customerMany, true)}
            {word("placeOne", base.en.place, false)}{word("placeMany", base.en.placeMany, false)}
            {word("placeOneAr", base.ar.place, true)}{word("placeManyAr", base.ar.placeMany, true)}
          </div>
        </div>
      </details>
    </>
  );
}
