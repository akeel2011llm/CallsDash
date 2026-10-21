"use client";

import { useActionState, useState } from "react";
import { changeOwnPasswordAction, createUserAction, resetPasswordAction, type PasswordState, type UserActionState } from "@/lib/user-actions";
import { SubmitButton } from "./SubmitButton";
import { Notice } from "./ui";

export interface UserFormText {
  new: string; fullName: string; email: string; role: string; client: string; password: string; passwordHelp: string; create: string;
  roleAdmin: string; roleManager: string; roleReceptionist: string; roleDoctor: string; doctor: string; doctorHelp: string;
  credCreated: string; credReset: string; credNote: string; credEmail: string; credPassword: string; credSignIn: string; credCopy: string; credCopied: string; credWhatsapp: string; credMessage: string;
  reset: string;
  errors: Record<string, string>;
}

/** Sign-in details shown once after an account is created or a password is reset, with the easiest ways to pass them on. */
export function CredentialsCard({ c, text }: { c: NonNullable<UserActionState["credentials"]>; text: UserFormText }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? c.loginPath : `${window.location.origin}${c.loginPath}`;
  const message = text.credMessage.replace("{name}", c.fullName).replace("{url}", url).replace("{email}", c.email).replace("{password}", c.password);
  const copy = async () => {
    try { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the details are on screen anyway */ }
  };
  return (
    <div className="cred" role="status">
      <strong>{c.kind === "created" ? text.credCreated : text.credReset}{c.clientName ? ` · ${c.clientName}` : ""}</strong>
      <dl>
        <dt>{text.credEmail}</dt><dd dir="ltr">{c.email}</dd>
        <dt>{text.credPassword}</dt><dd dir="ltr"><code>{c.password}</code></dd>
        <dt>{text.credSignIn}</dt><dd dir="ltr">{url}</dd>
      </dl>
      <small className="muted">{text.credNote}</small>
      <div className="row">
        <button type="button" className="btn small" onClick={copy}>{copied ? text.credCopied : text.credCopy}</button>
        <a className="btn small ghost" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(message)}`}>{text.credWhatsapp}</a>
      </div>
    </div>
  );
}

const initial: UserActionState = {};

/** Create a person. `tenants` is given for admins (who pick the client); a client manager's form has no client or role choice. */
export function CreateUserForm({ text, tenants, fixedTenantId, roles, doctors = [] }: {
  text: UserFormText; tenants?: { id: string; name: string }[]; fixedTenantId?: string; roles: ("admin" | "manager" | "receptionist" | "doctor")[];
  /** The doctors a doctor sign-in can belong to. */
  doctors?: { id: string; tenantId: string; name: string }[];
}) {
  const [state, action] = useActionState(createUserAction, initial);
  const [role, setRole] = useState(roles[0]);
  const [tenantId, setTenantId] = useState(fixedTenantId ?? tenants?.[0]?.id ?? doctors[0]?.tenantId ?? "");
  const label = { admin: text.roleAdmin, manager: text.roleManager, receptionist: text.roleReceptionist, doctor: text.roleDoctor };
  return (
    <form action={action} className="card stack" style={{ maxWidth: 640 }}>
      <h2>{text.new}</h2>
      {state.error && <Notice tone="warn">{text.errors[state.error] ?? state.error}</Notice>}
      {state.credentials && <CredentialsCard c={state.credentials} text={text} />}
      <div className="grid" style={{ gap: ".75rem", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
        <label>{text.fullName}<input name="fullName" required maxLength={120} autoComplete="off" /></label>
        <label>{text.email}<input name="email" type="email" required maxLength={160} autoComplete="off" inputMode="email" autoCapitalize="none" dir="ltr" /></label>
        {roles.length > 1 && (
          <label>{text.role}
            <select name="role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              {roles.map((r) => <option key={r} value={r}>{label[r]}</option>)}
            </select>
          </label>
        )}
        {roles.length === 1 && <input type="hidden" name="role" value={roles[0]} />}
        {fixedTenantId && <input type="hidden" name="tenantId" value={fixedTenantId} />}
        {tenants && !fixedTenantId && role !== "admin" && (
          <label>{text.client}
            <select name="tenantId" required value={tenantId} onChange={(e) => setTenantId(e.target.value)}>{tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </label>
        )}
        {role === "doctor" && (
          <label>{text.doctor}
            <select name="doctorId" required>{doctors.filter((d) => d.tenantId === tenantId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            <small className="muted">{text.doctorHelp}</small>
          </label>
        )}
        <label>{text.password}<input name="password" type="text" autoComplete="off" dir="ltr" placeholder="•••• •••• ••••" /><small className="muted">{text.passwordHelp}</small></label>
      </div>
      <div><SubmitButton className="btn" type="submit">{text.create}</SubmitButton></div>
    </form>
  );
}

export function ResetPasswordForm({ userId, text }: { userId: string; text: UserFormText }) {
  const [state, action] = useActionState(resetPasswordAction, initial);
  return (
    <form action={action} className="stack" style={{ gap: ".5rem" }}>
      <input type="hidden" name="userId" value={userId} />
      <SubmitButton className="btn small ghost" type="submit">{text.reset}</SubmitButton>
      {state.error && <Notice tone="warn">{text.errors[state.error] ?? state.error}</Notice>}
      {state.credentials && <CredentialsCard c={state.credentials} text={text} />}
    </form>
  );
}

export interface PasswordText { newPw: string; confirm: string; save: string; rules: string; errors: Record<string, string> }

export function PasswordForm({ text }: { text: PasswordText }) {
  const [state, action] = useActionState<PasswordState, FormData>(changeOwnPasswordAction, {});
  return (
    <form action={action} className="stack">
      {state.error && <Notice tone="warn">{text.errors[state.error] ?? state.error}</Notice>}
      <label>{text.newPw}<input name="password" type="password" autoComplete="new-password" required minLength={10} /></label>
      <label>{text.confirm}<input name="confirm" type="password" autoComplete="new-password" required minLength={10} /></label>
      <small className="muted">{text.rules}</small>
      <div><SubmitButton className="btn" type="submit">{text.save}</SubmitButton></div>
    </form>
  );
}
