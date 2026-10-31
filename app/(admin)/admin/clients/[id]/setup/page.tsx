import Link from "next/link";
import { notFound } from "next/navigation";
import { getT, type Key } from "@/lib/i18n";
import * as store from "@/lib/data";
import { authAdmin } from "@/lib/auth-admin-supabase";
import { wizardFor } from "@/lib/setup-facts";
import { isPhase, missingForLive, type PhaseId, type WizardItem } from "@/lib/wizard";
import { firstOpenStep, neighbours, stepStates } from "@/lib/steps";
import { businessOf, rulesOf } from "@/lib/business-types";
import { applyScanAction, goLiveAction, scanWebsiteAction, toggleChecklistAction, undoLiveAction } from "@/lib/onboarding-actions";
import { adminAddPlanAction, adminTopUpAction } from "@/lib/actions";
import { adminBusinessAction } from "@/lib/manage-actions";
import { syncAgentAction } from "@/lib/channel-actions";
import { listUsers } from "@/lib/users";
import { userFormText } from "@/lib/user-text";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { planNames } from "@/lib/plans";
import { CreateUserForm } from "@/components/UserForms";
import { BusinessFields } from "@/components/BusinessFields";
import { ContactForm } from "@/components/ContactForm";
import { PlanPicker } from "@/components/PlanPicker";
import { TryAssistant } from "@/components/TryAssistant";
import { AssistantCheck } from "@/components/AssistantCheck";
import { Stepper, stepperText } from "@/components/Stepper";
import { Icon } from "@/components/icons";
import { Badge, Notice, PageHead, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import type { Channel } from "@/lib/types";

type Search = { step?: string; saved?: string; scan?: string; error?: string; missing?: string };
const SYNC_ERRORS = ["no_api_key", "no_secret", "bad_secret", "no_app_url", "unknown_client", "failed"];
const CHANNELS: Channel[] = ["website", "whatsapp", "instagram", "phone"];
const TONE = { connected: "ok", pending: "warn", off: "neutral" } as const;

/**
 * The setup wizard (docs/reorganization.md, milestone 5): five phases, each with the forms it needs, for new and existing
 * clients alike. Without ?step= it opens at the first unfinished phase, so a client set up halfway resumes where it stopped.
 * The business type decides what is required (a shop needs no staff calendars but does need catalogue items).
 */
export default async function Setup({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tenant = await store.getTenant(id);
  if (!tenant) notFound();
  const [{ t, locale }, { t: plain }, wiz] = await Promise.all([getT(tenant), getT(), wizardFor(tenant)]);
  const { phases } = wiz;
  const steps = phases.map((p) => ({ id: p.id, done: p.done }));
  const current: PhaseId = isPhase(sp.step) ? sp.step : ((firstOpenStep(steps) as PhaseId | null) ?? "channels");
  const states = stepStates(steps, current);
  const phase = phases.find((p) => p.id === current)!;
  const missing = missingForLive(phases);
  const { prev, next } = neighbours(phases, current);
  const base = `/admin/clients/${id}`;
  const here = `${base}/setup?step=${current}`;
  const rules = rulesOf(tenant);
  const liveAt = tenant.onboarding.liveAt;
  const itemLabel = (i: { id: string }) => (i.id === "content" ? t(rules.needsCatalog ? "wiz.item.catalog" : "wiz.item.content") : t(`setup.item.${i.id}` as Key));
  const asked = (sp.missing ?? "").split(",").filter((m) => missing.some((x) => x.item === m));

  return (
    <>
      <PageHead title={t("setup.title")} subtitle={t("wiz.subtitle")} />
      <Stepper
        label={t("wiz.label")}
        text={stepperText(t)}
        steps={states.map((s) => ({ id: s.id, label: t(`wiz.phase.${s.id}` as Key), status: s.status, href: `${base}/setup?step=${s.id}` }))}
      />
      {liveAt && sp.saved !== "live" ? <Notice tone="ok">{t("wiz.liveSince").replace("{date}", fmtDate(liveAt, locale))}</Notice>
        : missing.length === 0 && current !== "channels" ? <Notice tone="ok">{t("wiz.ready")} <Link href={`${base}/setup?step=channels#live`}>{t("wiz.goLive")}</Link></Notice> : null}
      {asked.length > 0 && <Notice tone="warn">{t("wiz.missing")} {asked.map((m) => itemLabel({ id: m })).join(", ")}</Notice>}
      {sp.saved && sp.saved !== "synced" && sp.saved !== "created" && sp.saved !== "business" && (
        <Notice tone="ok">{sp.saved === "live" ? t("wiz.wentLive") : sp.saved === "reopened" ? t("wiz.reopened") : t("agent.saved").split(".")[0] + "."}</Notice>
      )}
      {sp.saved === "business" && <Notice tone="ok">{plain("biz.saved")}</Notice>}

      <section className="card stack" aria-labelledby="phase-title">
        <div>
          <h2 id="phase-title" style={{ margin: 0 }}>{t(`wiz.phase.${current}` as Key)}</h2>
          <p className="muted" style={{ margin: ".25rem 0 0" }}>{t(`wiz.phase.${current}.help` as Key)}</p>
        </div>
        <ul className="checklist">
          {phase.items.map((i) => <ItemRow key={i.id} i={i} label={itemLabel(i)} hint={hintOf(i, t, rules.needsCatalog)} t={t} tenantId={id} returnTo={here} />)}
        </ul>
      </section>

      {current === "business" && <BusinessPhase />}
      {current === "plan" && <PlanPhase />}
      {current === "people" && <PeoplePhase />}
      {current === "assistant" && <AssistantPhase />}
      {current === "channels" && <ChannelsPhase />}

      <nav className="row wiz-nav" aria-label={t("wiz.label")}>
        {prev ? <Link className="btn ghost" href={`${base}/setup?step=${prev}`}>{t("wiz.back")}</Link> : <span />}
        {next && <Link className={`btn${phase.done ? "" : " ghost"}`} href={`${base}/setup?step=${next}`}>{phase.done ? t("wiz.next") : t("wiz.skip")}</Link>}
      </nav>
    </>
  );

  // ---- phases. Each form returns here (returnTo), so the admin stays in the wizard. ----

  async function BusinessPhase() {
    const biz = businessOf(tenant!);
    const scan = tenant!.onboarding.scan;
    return (
      <>
        <section className="card stack" id="business">
          <h2>{plain("biz.title")}</h2>
          <form action={adminBusinessAction} className="stack">
            <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={here} />
            <small className="muted">{plain("biz.help")}</small>
            <BusinessFields t={plain} business={biz} />
            <div><SubmitButton className="btn" type="submit">{plain("common.save")}</SubmitButton></div>
          </form>
        </section>
        <section className="card stack" id="contact">
          <h2>{t("ws.contact")}</h2>
          {(sp.error === "name" || sp.error === "domain") && <Notice tone="warn">{t(`admin.err.${sp.error}` as "admin.err.name")}</Notice>}
          <ContactForm tenant={tenant!} t={t} returnTo={here} />
        </section>
        <section className="card stack" id="website">
          <h2>{t("wiz.scan.title")}</h2>
          <p className="muted">{t("setup.scan.help")}</p>
          {sp.scan && <Notice tone="warn">{t(`setup.scan.err.${sp.scan}` as Key)}</Notice>}
          <form action={scanWebsiteAction} className="row" style={{ alignItems: "end" }}>
            <input type="hidden" name="tenantId" value={id} />
            <label style={{ flex: 1, minWidth: 220 }}>{t("setup.scan.url")}<input name="url" defaultValue={scan?.url ?? tenant!.branding.domain ?? ""} placeholder="clinic.example.bh" dir="ltr" required /></label>
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
                {scan.phones[0] && !tenant!.branding.supportPhone && <label className="inline"><input type="checkbox" name="phone" defaultChecked />{t("setup.apply.phone")}: <span dir="ltr">{scan.phones[0]}</span></label>}
                {scan.emails[0] && !tenant!.branding.supportEmail && <label className="inline"><input type="checkbox" name="email" defaultChecked />{t("setup.apply.email")}: <span dir="ltr">{scan.emails[0]}</span></label>}
                <div><SubmitButton className="btn" type="submit">{t("setup.apply")}</SubmitButton></div>
              </form>
            </>
          )}
        </section>
        <section className="card stack">
          <h2>{t("setup.item.branding")}</h2>
          <p className="muted">{t("wiz.branding.help")}</p>
          <div><Link className="btn ghost" href={`${base}/business/branding`}>{t("wiz.open.branding")}</Link></div>
        </section>
      </>
    );
  }

  async function PlanPhase() {
    const [w, catalogue] = await Promise.all([store.getWallet(id), store.listPackages()]);
    const active = tenant!.plans.filter((p) => p.active);
    return (
      <>
        <div className="grid">
          <Stat label={t("admin.balance")} value={fmtNum(w.balance, locale, 1)} tone={w.balance > 0 ? undefined : "warn"} hint={planNames(tenant!.plans)} />
        </div>
        <section className="card stack" id="plans">
          <h2>{t("plans.title")}</h2>
          {active.length > 0 && (
            <ul className="checklist">
              {active.map((p) => (
                <li key={p.id} className="done">
                  <span className="mark" aria-hidden><Icon name="tick" size={16} /></span>
                  <div><span className="title">{p.name}</span><small>{p.type === "package" ? `${fmtNum(p.includedCredits, locale, 0)} ${t("packages.creditsWord")} · ` : ""}BHD {fmtNum(p.monthlyPriceBhd, locale, 0)} {t("packages.perMonth")}</small></div>
                  <span />
                </li>
              ))}
            </ul>
          )}
          {catalogue.some((p) => !p.archived) ? (
            <form action={adminAddPlanAction} className="stack">
              <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={here} />
              <PlanPicker packages={catalogue} locale={locale} t={t} />
              <div><SubmitButton className="btn" type="submit">{t("plans.add")}</SubmitButton></div>
            </form>
          ) : <Notice tone="warn">{t("wiz.plan.noPackages")} <Link href="/admin/billing/packages">{t("billing.packages")}</Link></Notice>}
        </section>
        <section className="card stack" id="credits">
          <h2>{t("admin.grant")}</h2>
          <form action={adminTopUpAction} className="row">
            <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={here} />
            <label style={{ flex: 1 }}>{t("admin.amount")}<input name="credits" type="number" min="1" step="1" defaultValue={500} required /></label>
            <label style={{ flex: 2 }}>{t("wiz.note")}<input name="note" placeholder="Invoice 2026-114" maxLength={120} /></label>
            <SubmitButton className="btn" type="submit">{t("admin.grant")}</SubmitButton>
          </form>
          <small className="muted">{t("admin.grantHelp")}</small>
          <small><Link href={`${base}/billing`}>{t("wiz.open.billing")}</Link></small>
        </section>
      </>
    );
  }

  async function PeoplePhase() {
    const auth = authAdmin();
    const [people, doctors] = await Promise.all([
      auth ? listUsers({ auth, data: store }, id) : store.listProfiles(id).then((ps) => ps.map((p) => ({ ...p, lastSignIn: undefined }))),
      store.getDoctors(id),
    ]);
    return (
      <>
        <section className="stack" id="team">
          <div className="card stack">
            <h2>{t("setup.team.title").replace(/^\d+\.\s*/, "")}</h2>
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
          {auth ? <CreateUserForm text={userFormText(t)} fixedTenantId={id} roles={["manager", "receptionist", "doctor"]} doctors={doctors} /> : <Notice tone="warn">{t("users.err.not_configured")}</Notice>}
        </section>
        <section className="card stack" id="staff">
          <h2>{t("doctors.title")}</h2>
          {rules.needsStaff ? (
            <>
              <p className="muted">{t("wiz.staff.help")}</p>
              {doctors.length > 0 && (
                <ul className="checklist">
                  {doctors.map((d) => (
                    <li key={d.id} className={d.googleCalendarId ? "done" : undefined}>
                      <span className="mark" aria-hidden><Icon name="tick" size={16} /></span>
                      <div><span className="title">{d.name}{d.active === false ? ` · ${t("wiz.staff.inactive")}` : ""}</span><small>{d.googleCalendarId ? t("wiz.staff.calendar") : t("wiz.staff.noCalendar")}</small></div>
                      <span />
                    </li>
                  ))}
                </ul>
              )}
              <div><Link className="btn" href={`${base}/people#doctors`}>{t("wiz.open.staff")}</Link></div>
            </>
          ) : (
            <p className="muted">{plain("wiz.staff.notNeeded")} <Link href={`${base}/setup?step=business#business`}>{plain("biz.title")}</Link></p>
          )}
        </section>
      </>
    );
  }

  async function AssistantPhase() {
    const agent = await store.getAgent(id).catch(() => undefined);
    const agentId = agent?.elevenLabsAgentId ?? "";
    const syncError = sp.error && SYNC_ERRORS.includes(sp.error) ? sp.error : null;
    return (
      <>
        <section className="card stack" id="content">
          <h2>{t("wiz.content.title")}</h2>
          <p className="muted">{t(rules.needsCatalog ? "wiz.content.helpCatalog" : "wiz.content.help")}</p>
          <div className="grid">
            <Stat label={t("data.cat.title")} value={fmtNum(wiz.catalogCount, locale, 0)} tone={rules.needsCatalog && !wiz.catalogCount ? "warn" : undefined} />
            <Stat label={t("data.know.title")} value={fmtNum(wiz.knowledgeCount, locale, 0)} />
          </div>
          <div className="row">
            <Link className="btn ghost" href={`${base}/data?open=catalogue#catalogue`}>{t("wiz.open.catalog")}</Link>
            <Link className="btn ghost" href={`${base}/data?open=knowledge#knowledge`}>{t("wiz.open.knowledge")}</Link>
            <Link className="btn ghost" href={`${base}/setup?step=business#website`}>{t("wiz.scan.title")}</Link>
          </div>
        </section>
        <section className="card stack" id="agent">
          <h2>{t("setup.item.agent")}</h2>
          <p className="muted">{t("wiz.agent.help")}</p>
          {syncError && <Notice tone="warn">{t(`channels.err.${syncError}` as Key)}</Notice>}
          {(sp.saved === "synced" || sp.saved === "created") && <Notice tone="ok">{t(sp.saved === "created" ? "wiz.agent.created" : "wiz.agent.synced")}</Notice>}
          <div className="row">
            {agentId ? <Badge tone="ok">{t("channels.agent.ready")}</Badge> : <Badge tone="warn">{t("channels.agent.none")}</Badge>}
            {agentId && <code dir="ltr">{agentId}</code>}
          </div>
          <div className="row">
            {tenant!.integrations.elevenlabs?.managed !== false && (
              <form action={syncAgentAction}>
                <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={here} />
                <SubmitButton className="btn" type="submit">{agentId ? t("try.update") : t("wiz.agent.create")}</SubmitButton>
              </form>
            )}
            <Link className="btn ghost" href={`${base}/assistant`}>{t("wiz.open.studio")}</Link>
          </div>
          <small className="muted">{t("wiz.agent.studioHelp")}</small>
        </section>
      </>
    );
  }

  async function ChannelsPhase() {
    return (
      <>
        <section className="card stack" id="channels">
          <h2>{t("ws.channels")}</h2>
          <p className="muted">{t("wiz.channels.help")}</p>
          <ul className="checklist">
            {CHANNELS.map((c) => (
              <li key={c} className={tenant!.channels[c] === "connected" ? "done" : undefined}>
                <span className="mark" aria-hidden><Icon name="tick" size={16} /></span>
                <div><span className="title">{t(`channel.${c}` as Key)}</span></div>
                <Badge tone={TONE[tenant!.channels[c]]}>{t(`channels.status.${tenant!.channels[c]}` as Key)}</Badge>
              </li>
            ))}
          </ul>
          <div><Link className="btn ghost" href={`${base}/channels`}>{t("wiz.open.channels")}</Link></div>
        </section>
        <TryAssistant tenant={tenant!} admin returnTo={here} sp={{ saved: sp.saved, error: sp.error }} />
        <AssistantCheck tenant={tenant!} />
        <section className="card stack" id="live">
          <h2>{t("wiz.goLive")}</h2>
          {liveAt ? (
            <>
              <p>{t("wiz.liveSince").replace("{date}", fmtDate(liveAt, locale))}</p>
              <form action={undoLiveAction}>
                <input type="hidden" name="tenantId" value={id} />
                <SubmitButton className="btn ghost" type="submit">{t("wiz.undoLive")}</SubmitButton>
              </form>
              <small className="muted">{t("wiz.undoLive.help")}</small>
            </>
          ) : (
            <>
              <p className="muted">{t("wiz.goLive.help")}</p>
              {missing.length > 0 && (
                <Notice tone="warn">
                  {t("wiz.missing")}
                  <ul style={{ margin: ".25rem 0 0", paddingInlineStart: "1.25rem" }}>
                    {missing.map((m) => <li key={m.item}><Link href={`${base}/setup?step=${m.phase}`}>{itemLabel({ id: m.item })}</Link> <small className="muted">({t(`wiz.phase.${m.phase}` as Key)})</small></li>)}
                  </ul>
                </Notice>
              )}
              <form action={goLiveAction}>
                <input type="hidden" name="tenantId" value={id} />
                <SubmitButton className="btn" type="submit" disabled={missing.length > 0}>{t("wiz.goLive")}</SubmitButton>
              </form>
            </>
          )}
        </section>
      </>
    );
  }
}

function hintOf(i: WizardItem, t: (k: Key) => string, catalogFirst: boolean): string {
  if (i.notNeeded) return t("wiz.notNeeded");
  const base = i.id === "content" ? t(catalogFirst ? "wiz.item.catalog.hint" : "wiz.item.content.hint") : t(`setup.item.${i.id}.hint` as Key);
  return i.required ? base : `${t("wiz.recommended")} · ${base}`;
}

function ItemRow({ i, label, hint, t, tenantId, returnTo }: { i: WizardItem; label: string; hint: string; t: (k: Key) => string; tenantId: string; returnTo: string }) {
  return (
    <li className={i.done ? "done" : undefined} style={i.notNeeded ? { opacity: 0.65 } : undefined}>
      <span className="mark" aria-hidden>{i.notNeeded ? "–" : <Icon name="tick" size={16} />}</span>
      <div>
        <span className="title">{label}</span>
        <small>{hint}</small>
        <span className="sr-only">{` (${i.notNeeded ? t("steps.status.skipped") : i.done ? t("steps.status.done") : t("steps.status.todo")})`}</span>
      </div>
      {i.manual ? (
        <form action={toggleChecklistAction}>
          <input type="hidden" name="tenantId" value={tenantId} /><input type="hidden" name="item" value={i.id} /><input type="hidden" name="returnTo" value={returnTo} />
          <SubmitButton className="btn small ghost" type="submit">{i.done ? t("setup.undo") : t("setup.markDone")}</SubmitButton>
        </form>
      ) : i.done ? <Badge tone="ok">{t("steps.status.done")}</Badge> : i.notNeeded ? <span /> : <Badge tone={i.required ? "warn" : "neutral"}>{i.required ? t("wiz.required") : t("wiz.recommended")}</Badge>}
    </li>
  );
}
