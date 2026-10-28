import type { Customer } from "@/lib/types";

type T = (k: never) => string;

/** The customer form's fields, for adding and for editing. Phone and CPR read left to right in either language. */
export function CustomerFields({ t, c }: { t: T; c?: Customer }) {
  const tr = t as unknown as (k: string) => string;
  return (
    <>
      {c && <input type="hidden" name="id" value={c.id} />}
      <label>{tr("customers.name")}<input name="name" defaultValue={c?.name ?? ""} maxLength={120} autoComplete="off" /></label>
      <label>{tr("customers.phone")}<input name="phone" dir="ltr" inputMode="tel" required defaultValue={c?.phone ?? ""} maxLength={24} autoComplete="off" /><small className="muted">{tr("customers.phone.help")}</small></label>
      <label>{tr("customers.cpr")}<input name="cpr" dir="ltr" inputMode="numeric" defaultValue={c?.cpr ?? ""} maxLength={20} autoComplete="off" /><small className="muted">{tr("customers.cpr.help")}</small></label>
      <label>{tr("customers.email")}<input name="email" dir="ltr" type="email" defaultValue={c?.email ?? ""} maxLength={120} autoComplete="off" /></label>
      <label>{tr("customers.language")}
        <select name="language" defaultValue={c?.language ?? ""}>
          <option value="">{tr("customers.language.none")}</option>
          <option value="en">English</option>
          <option value="ar">العربية</option>
        </select>
      </label>
      <label>{tr("customers.notes")}<textarea name="notes" defaultValue={c?.notes ?? ""} maxLength={2000} /><small className="muted">{tr("customers.notes.help")}</small></label>
    </>
  );
}
