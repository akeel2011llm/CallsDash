import type { Key } from "./i18n";
import type { PasswordText, UserFormText } from "@/components/UserForms";

type T = (k: Key) => string;

/** Words the user forms need, resolved on the server so the client component carries no dictionary. */
export const userFormText = (t: T): UserFormText => ({
  new: t("users.new"), fullName: t("users.fullName"), email: t("users.email"), role: t("users.role"), client: t("users.client"),
  password: t("users.password"), passwordHelp: t("users.password.help"), create: t("users.create"),
  roleAdmin: t("users.role.admin"), roleManager: t("users.role.manager"), roleReceptionist: t("users.role.receptionist"), roleDoctor: t("users.role.doctor"), doctor: t("users.doctor"), doctorHelp: t("users.doctor.help"),
  credCreated: t("users.cred.created"), credReset: t("users.cred.reset"), credNote: t("users.cred.note"), credEmail: t("users.cred.email"),
  credPassword: t("users.cred.password"), credSignIn: t("users.cred.signin"), credCopy: t("users.cred.copy"), credCopied: t("users.cred.copied"),
  credWhatsapp: t("users.cred.whatsapp"), credMessage: t("users.cred.message"), reset: t("users.reset"),
  errors: Object.fromEntries((["email_invalid", "email_taken", "name_missing", "password_short", "password_weak", "forbidden", "unknown_client", "doctor_missing", "doctor_taken", "role_invalid", "last_admin", "self", "not_found", "not_configured"] as const)
    .map((c) => [c, t(`users.err.${c}` as Key)])),
});

export const passwordText = (t: T): PasswordText => ({
  newPw: t("account.new"), confirm: t("account.confirm"), save: t("account.save"), rules: t("account.rules"),
  errors: { short: t("account.err.short"), weak: t("account.err.weak"), mismatch: t("account.err.mismatch"), failed: t("account.err.failed"), demo: t("account.err.demo") },
});
