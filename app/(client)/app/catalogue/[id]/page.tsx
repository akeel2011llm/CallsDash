import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClient } from "@/lib/auth";
import { dictionaries, getT } from "@/lib/i18n";
import { getItem } from "@/lib/data";
import { deleteItemAction, saveItemAction } from "@/lib/item-actions";
import { ConfirmDelete } from "@/components/Confirm";
import { ItemFields } from "@/components/ItemFields";
import { Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { itemPhotoPath } from "@/lib/item-photo";

export default async function ItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; err?: string }> }) {
  const { tenant, staffRole } = await requireClient();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [{ t }, item] = await Promise.all([getT(), getItem(tenant.id, id)]);
  if (!item) notFound();
  const locked = !tenant.permissions.editKnowledge;
  const errKey = sp.err && /^[a-z_]+$/.test(sp.err) ? `catalogue.err.${sp.err}` : "";
  return (
    <>
      <PageHead title={item.name} actions={<Link className="btn small ghost" href="/app/catalogue">{t("catalogue.back")}</Link>} />
      {locked && <Notice tone="warn">{t("common.locked")}</Notice>}
      {sp.saved && <Notice tone="ok">{t("catalogue.saved")}</Notice>}
      {errKey in dictionaries.en && <Notice tone="warn">{t(errKey as "catalogue.err.no_name")}</Notice>}
      <section className="card stack">
        <form action={saveItemAction} className="stack">
          <fieldset disabled={locked} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <ItemFields t={t} item={item} photoSrc={item.active ? itemPhotoPath(tenant.slug, item) : undefined} />
            <div><SubmitButton className="btn" type="submit">{t("catalogue.save")}</SubmitButton></div>
          </fieldset>
        </form>
      </section>
      {staffRole === "manager" && !locked && (
        <section className="card">
          <ConfirmDelete action={deleteItemAction} summary={t("common.delete")} warning={t("catalogue.delete.warn")}
            tick={t("common.confirmTick")} button={t("common.delete")} fields={{ id: item.id }} />
        </section>
      )}
    </>
  );
}
