import type { Customer, Locale } from "@/lib/types";
import type { ExtraField } from "@/lib/extra-fields";
import { ExtraInputs } from "./ExtraFields";
import { ID_CPR, asksId, idInputProps, type IdRule } from "@/lib/id-rule";

type T = (k: never) => string;

/**
 * The customer form's fields, for adding and for editing. Phone and CPR read left to right in either language. `id` is the
 * client's ID number (lib/id-rule.ts); a business that asks for none has no ID box.
 */
export function CustomerFields({ t, c, id = ID_CPR, fields = [], locale = "en" }: { t: T; c?: Customer; id?: IdRule; fields?: ExtraField[]; locale?: Locale }) {
  const tr = t as unknown as (k: string) => string;
  return (
    <>
      {c && <input type="hidden" name="id" value={c.id} />}
      <label>{tr("customers.name")}<input name="name" defaultValue={c?.name ?? ""} maxLength={120} autoComplete="off" /></label>
      <label>{tr("customers.phone")}<input name="phone" dir="ltr" inputMode="tel" required defaultValue={c?.phone ?? ""} maxLength={24} autoComplete="off" /><small className="muted">{tr("customers.phone.help")}</small></label>
      {asksId(id) && <label>{tr("customers.cpr")}<input name="cpr" {...idInputProps(id)} placeholder={undefined} defaultValue={c?.cpr ?? ""} /><small className="muted">{tr("customers.cpr.help")}</small></label>}
      <label>{tr("customers.email")}<input name="email" dir="ltr" type="email" defaultValue={c?.email ?? ""} maxLength={120} autoComplete="off" /></label>
      <label>{tr("customers.language")}
        <select name="language" defaultValue={c?.language ?? ""}>
          <option value="">{tr("customers.language.none")}</option>
          <option value="en">English</option>
          <option value="ar">العربية</option>
        </select>
      </label>
      <ExtraInputs fields={fields} values={c?.extra} t={tr as never} locale={locale} />
      <label>{tr("customers.notes")}<textarea name="notes" defaultValue={c?.notes ?? ""} maxLength={2000} /><small className="muted">{tr("customers.notes.help")}</small></label>
    </>
  );
}
