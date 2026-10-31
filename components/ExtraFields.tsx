import type { Key } from "@/lib/i18n";
import { fill } from "@/lib/format";
import { EXTRA_TYPES, MAX_EXTRA, extraLines, type ExtraField, type ExtraTarget, type ExtraValues } from "@/lib/extra-fields";
import { adminExtraFieldsAction } from "@/lib/manage-actions";
import type { Locale } from "@/lib/types";
import { Fold } from "./Fold";
import { SubmitButton } from "./SubmitButton";
import { FieldInput } from "./TablesView";

type T = (k: Key) => string;

/**
 * The admin's designer for one target's own fields (Business tab): a line per field with its names, type, answers, order,
 * required, and the assistant box; three empty lines to add more. Same layout as a custom table's columns.
 */
export function ExtraFieldsDesigner({ tenantId, target, fields, t, open }: { tenantId: string; target: ExtraTarget; fields: ExtraField[]; t: T; open: boolean }) {
  const lines: (ExtraField | null)[] = [...fields, ...Array.from({ length: Math.min(3, MAX_EXTRA - fields.length) }, () => null)];
  return (
    <Fold id={`fields-${target}`} open={open} title={t(`fields.${target}` as Key)} hint={fields.length ? fill(t("fields.count"), { n: fields.length }) : t("fields.none")}>
      <form action={adminExtraFieldsAction} className="stack">
        <input type="hidden" name="tenantId" value={tenantId} /><input type="hidden" name="target" value={target} />
        <input type="hidden" name="returnTo" value={`/admin/clients/${tenantId}/business`} />
        <input type="hidden" name="n" value={lines.length} />
        <small className="muted">{t(`fields.${target}.help` as Key)}</small>
        <ol className="stack" style={{ paddingInlineStart: 0, listStyle: "none" }}>
          {lines.map((f, i) => (
            <li key={f?.key ?? `new${i}`} className="col-line stack">
              {f && <input type="hidden" name={`f${i}_key`} value={f.key} />}
              <strong>{f ? fill(t("tables.column"), { n: i + 1 }) : t("fields.new")}</strong>
              <div className="form-cols">
                <label>{t("tables.colLabel")}<input name={`f${i}_label`} maxLength={60} defaultValue={f?.label ?? ""} required={Boolean(f)} dir="ltr" /></label>
                <label>{t("tables.colLabelAr")}<input name={`f${i}_labelAr`} maxLength={60} dir="rtl" defaultValue={f?.labelAr ?? ""} /></label>
                <label>{t("tables.colType")}
                  <select name={`f${i}_type`} defaultValue={f?.type ?? "text"}>
                    {EXTRA_TYPES.map((ty) => <option key={ty} value={ty}>{t(`tables.type.${ty}` as Key)}</option>)}
                  </select>
                </label>
                <label>{t("tables.colOrder")}<input name={`f${i}_order`} type="number" min={1} max={40} defaultValue={i + 1} inputMode="numeric" /></label>
              </div>
              <label>{t("tables.colOptions")}<textarea name={`f${i}_options`} rows={2} defaultValue={(f?.options ?? []).join("\n")} placeholder={t("tables.colOptionsPh")} /></label>
              <div className="row">
                <label className="inline"><input type="checkbox" name={`f${i}_required`} defaultChecked={Boolean(f?.required)} />{t("tables.colRequired")}</label>
                <label className="inline"><input type="checkbox" name={`f${i}_ask`} defaultChecked={f ? Boolean(f.ask) : target !== "team"} />{t(`fields.ask.${target}` as Key)}</label>
                {f && <label className="inline"><input type="checkbox" name={`f${i}_remove`} />{t("tables.colRemove")}</label>}
              </div>
            </li>
          ))}
        </ol>
        <small className="muted">{t("fields.removeNote")}</small>
        <div><SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton></div>
      </form>
    </Fold>
  );
}

/** The inputs for a client's own fields on a form (x_<key>), filled with the stored answers. Nothing when there are no fields. */
export function ExtraInputs({ fields, values, t, locale }: { fields: ExtraField[]; values?: ExtraValues; t: T; locale: Locale }) {
  if (!fields.length) return null;
  return <><input type="hidden" name="extraShown" value="1" />{fields.map((f) => <FieldInput key={f.key} f={f} value={values?.[f.key] ?? ""} t={t} locale={locale} prefix="x_" />)}</>;
}

/** The stored answers on one line ("Languages: Arabic · Gender: Female"), for a list. */
export function ExtraValuesInline({ fields, values, t, locale }: { fields: ExtraField[]; values?: ExtraValues; t: T; locale: Locale }) {
  const lines = extraLines(fields, values, locale, { yes: t("tables.yes"), no: t("tables.no") });
  return lines.length ? <>{lines.map((l) => `${l.label}: ${l.value}`).join(" · ")}</> : null;
}

/** The stored answers as "label: value" lines, for a detail screen. Nothing when no field has an answer. */
export function ExtraValuesList({ fields, values, t, locale }: { fields: ExtraField[]; values?: ExtraValues; t: T; locale: Locale }) {
  const lines = extraLines(fields, values, locale, { yes: t("tables.yes"), no: t("tables.no") });
  if (!lines.length) return null;
  return <>{lines.map((l) => <div key={l.key}>{l.label}: <span dir="auto">{l.value}</span></div>)}</>;
}
