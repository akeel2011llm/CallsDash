import Link from "next/link";
import { notFound } from "next/navigation";
import { getT, type Key } from "@/lib/i18n";
import * as store from "@/lib/data";
import { authAdmin } from "@/lib/auth-admin-supabase";
import { checklistFor } from "@/lib/setup-facts";
import { progress, type ChecklistId } from "@/lib/checklist";
import { applyScanAction, scanWebsiteAction, setupDetailsAction, toggleChecklistAction } from "@/lib/onboarding-actions";
import { listUsers } from "@/lib/users";
import { userFormText } from "@/lib/user-text";
import { fmtDateTime } from "@/lib/format";
import { CreateUserForm } from "@/components/UserForms";
import { Icon } from "@/components/icons";
import { Badge, Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export default async function Setup({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; scan?: string; error?: string }> }) {
  const { id } = await params;
  const { saved, scan: scanError, error } = await searchParams;
  const tenant = await store.getTenant(id);
  if (!tenant) notFound();
  const [{ t, locale }, items] = await Promise.all([getT(), checklistFor(tenant)]);
  const auth = authAdmin();
  const people = auth ? await listUsers({ auth, data: store }, id) : (await store.listProfiles(id)).map((p) => ({ ...p, lastSignIn: undefined }));
  const p = progress(items);
  const scan = tenant.onboarding.scan;
  const base = `/admin/clients/${id}`;
  const where: Record<ChecklistId, string | null> = {
    details: "#details", branding: `${base}/branding`, plan: base, knowledge: "#website", hours: null, calendar: base,
    team: "#team", agent: base, channel: base, test: base,
  };
  const name = locale === "ar" ? tenant.branding.displayNameAr : tenant.name;
  return (
    <>
      <PageHead title={`${t("setup.title")}: ${name}`} subtitle={t("setup.subtitle")} actions={<Link className="btn ghost" href={base}>{t("common.back")}</Link>} />
      {saved && <Notice tone="ok">{t("users.saved")}</Notice>}
      {(error === "name" || error === "domain") && <Notice tone="warn">{t(`admin.err.${error}` as "admin.err.name")}</Notice>}

      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{p.done} / {p.total} {t("setup.progress")}</h2>
          {p.done === p.total && <Badge tone="ok">{t("setup.ready")}</Badge>}
        </div>
        <div className="progress" role="progressbar" aria-valuenow={p.done} aria-valuemin={0} aria-valuemax={p.total}><span style={{ inlineSize: `${(p.done / p.total) * 100}%` }} /></div>
        <ul className="checklist">
          {items.map((i) => (
            <li key={i.id} className={i.done ? "done" : undefined}>
              <span className="mark" aria-hidden><Icon name="tick" size={16} /></span>
              <div>
                <span className="title">{t(`setup.item.${i.id}` as Key)}</span>
                <small>{t(`setup.item.${i.id}.hint` as Key)}</small>
              </div>
              {i.manual ? (
                <form action={toggleChecklistAction}>
                  <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="item" value={i.id} />
                  <SubmitButton className="btn small ghost" type="submit">{i.done ? t("setup.undo") : t("setup.markDone")}</SubmitButton>
                </form>
              ) : !i.done && where[i.id] ? <Link className="btn small ghost" href={where[i.id]!}>{t("setup.open")}</Link> : <span />}
            </li>
          ))}
        </ul>
      </section>

      <section className="card stack" id="details">
        <h2>{t("setup.details.title")}</h2>
        <p className="muted">{t("setup.details.help")}</p>
        <form action={setupDetailsAction} className="stack">
          <input type="hidden" name="tenantId" value={id} />
          <div className="grid two" style={{ gap: ".75rem" }}>
            <label>{t("setup.domain")}<input name="domain" defaultValue={tenant.branding.domain ?? ""} placeholder="clinic.example.bh" dir="ltr" maxLength={200} /></label>
            <label>{t("setup.phone")}<input name="supportPhone" defaultValue={tenant.branding.supportPhone ?? ""} dir="ltr" maxLength={40} inputMode="tel" /></label>
            <label>{t("setup.email")}<input name="supportEmail" type="email" defaultValue={tenant.branding.supportEmail ?? ""} dir="ltr" maxLength={120} /></label>
            <label>{t("setup.whatsapp")}<input name="supportWhatsapp" defaultValue={tenant.branding.supportWhatsapp ?? ""} dir="ltr" maxLength={40} inputMode="tel" /></label>
          </div>
          <div><SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton></div>
        </form>
      </section>

      <section className="card stack" id="website">
        <h2>{t("setup.scan.title")}</h2>
        <p className="muted">{t("setup.scan.help")}</p>
        {scanError && <Notice tone="warn">{t(`setup.scan.err.${scanError}` as Key)}</Notice>}
        <form action={scanWebsiteAction} className="row" style={{ alignItems: "end" }}>
          <input type="hidden" name="tenantId" value={id} />
          <label style={{ flex: 1, minWidth: 220 }}>{t("setup.scan.url")}<input name="url" defaultValue={scan?.url ?? tenant.branding.domain ?? ""} placeholder="clinic.example.bh" dir="ltr" required /></label>
          <SubmitButton className="btn" type="submit">{scan ? t("setup.scan.again") : t("setup.scan.run")}</SubmitButton>
        </form>
        {scan && (
          <>
            <dl className="scan-grid">
              <dt>{t("setup.scan.at")}</dt><dd>{fmtDateTime(scan.at, locale)} · <span dir="ltr">{scan.url}</span></dd>
              {scan.title && <><dt>{t("setup.scan.name")}</dt><dd>{scan.title}</dd></>}
              {scan.description && <><dt>{t("setup.scan.desc")}</dt><dd>{scan.description}</dd></>}
              {scan.phones.length > 0 && <><dt>{t("setup.scan.phones")}</dt><dd dir="ltr">{scan.phones.join("  ·  ")}</dd></>}
              {scan.emails.length > 0 && <><dt>{t("setup.scan.emails")}</dt><dd dir="ltr">{scan.emails.join("  ·  ")}</dd></>}
              {scan.languages.length > 0 && <><dt>{t("setup.scan.languages")}</dt><dd>{scan.languages.map((l) => (l === "ar" ? "العربية" : "English")).join("  ·  ")}</dd></>}
              {scan.headings.length > 0 && <><dt>{t("setup.scan.headings")}</dt><dd>{scan.headings.slice(0, 10).join("  ·  ")}</dd></>}
            </dl>
            {scan.text && <div className="scan-text" aria-label={t("setup.scan.text")}>{scan.text.slice(0, 1200)}{scan.text.length > 1200 ? "…" : ""}</div>}
            <form action={applyScanAction} className="stack">
              <input type="hidden" name="tenantId" value={id} />
              {scan.text && <label className="inline"><input type="checkbox" name="text" defaultChecked />{t("setup.apply.text")}</label>}
              {scan.description && <label className="inline"><input type="checkbox" name="description" defaultChecked />{t("setup.apply.description")}</label>}
              {scan.phones[0] && !tenant.branding.supportPhone && <label className="inline"><input type="checkbox" name="phone" defaultChecked />{t("setup.apply.phone")}: <span dir="ltr">{scan.phones[0]}</span></label>}
              {scan.emails[0] && !tenant.branding.supportEmail && <label className="inline"><input type="checkbox" name="email" defaultChecked />{t("setup.apply.email")}: <span dir="ltr">{scan.emails[0]}</span></label>}
              <div><SubmitButton className="btn" type="submit">{t("setup.apply")}</SubmitButton></div>
            </form>
          </>
        )}
      </section>

      <section className="stack" id="team">
        <div className="card stack">
          <h2>{t("setup.team.title")}</h2>
          <p className="muted">{t("setup.team.help")}</p>
          {people.length > 0 && (
            <ul className="checklist">
              {people.map((u) => (
                <li key={u.id}>
                  <span className="mark" aria-hidden style={{ color: "var(--muted)" }}><Icon name="user" size={16} /></span>
                  <div><span className="title">{u.fullName || u.email}</span><small dir="ltr">{u.email}</small></div>
                  <Badge>{t(`users.role.${u.role}` as Key)}</Badge>
                </li>
              ))}
            </ul>
          )}
          <small><Link href={`/admin/users?c=${id}`}>{t("users.title")}</Link></small>
        </div>
        {auth ? <CreateUserForm text={userFormText(t)} fixedTenantId={id} roles={["manager", "receptionist"]} /> : <Notice tone="warn">{t("users.err.not_configured")}</Notice>}
      </section>
    </>
  );
}
