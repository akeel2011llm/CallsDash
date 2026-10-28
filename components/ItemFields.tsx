import type { Item } from "@/lib/types";
import { ItemPhotoInput } from "./ItemPhotoInput";

type T = (k: never) => string;

/** The catalogue form's fields, for adding and for editing. */
export function ItemFields({ t, item, photoSrc }: { t: T; item?: Item; photoSrc?: string }) {
  const tr = t as unknown as (k: string) => string;
  return (
    <>
      {item && <input type="hidden" name="id" value={item.id} />}
      <label>{tr("catalogue.name")}<input name="name" required maxLength={120} defaultValue={item?.name ?? ""} autoComplete="off" /></label>
      <label>{tr("catalogue.nameAr")}<input name="nameAr" dir="rtl" maxLength={120} defaultValue={item?.nameAr ?? ""} autoComplete="off" /></label>
      <label>{tr("catalogue.details")}<textarea name="details" maxLength={1500} defaultValue={item?.details ?? ""} /><small className="muted">{tr("catalogue.details.help")}</small></label>
      <label>{tr("catalogue.detailsAr")}<textarea name="detailsAr" dir="rtl" maxLength={1500} defaultValue={item?.detailsAr ?? ""} /></label>
      <label>{tr("catalogue.price")}<input name="price" maxLength={60} defaultValue={item?.price ?? ""} autoComplete="off" placeholder="BHD 25" /><small className="muted">{tr("catalogue.price.help")}</small></label>
      <label>{tr("catalogue.keywords")}<input name="keywords" maxLength={300} defaultValue={item?.keywords ?? ""} autoComplete="off" /><small className="muted">{tr("catalogue.keywords.help")}</small></label>
      {item?.hasImage && photoSrc && (
        <div className="stack" style={{ gap: ".35rem" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoSrc} alt={item.name} style={{ maxInlineSize: 200, maxBlockSize: 200, objectFit: "cover", borderRadius: 8 }} />
          <label className="inline"><input type="checkbox" name="removePhoto" />{tr("catalogue.photo.remove")}</label>
        </div>
      )}
      {item?.hasImage && !photoSrc && <small className="muted">{tr("catalogue.photo.hiddenHas")}</small>}
      <ItemPhotoInput name="photo" label={tr(item?.hasImage ? "catalogue.photo.replace" : "catalogue.photo")} working={tr("catalogue.photo.working")} failed={tr("catalogue.photo.failed")} />
      <small className="muted">{tr("catalogue.photo.help")}</small>
      <label className="inline"><input type="checkbox" name="active" defaultChecked={item ? item.active : true} />{tr("catalogue.active")}</label>
      <small className="muted">{tr("catalogue.active.help")}</small>
    </>
  );
}
