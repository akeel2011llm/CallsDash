import Link from "next/link";
import { getT } from "@/lib/i18n";
import { forgotPasswordAction } from "@/lib/user-actions";
import { Notice } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function Forgot({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  const { t } = await getT();
  return (
    <main className="auth-page">
      <div className="card stack">
        <h1>{t("forgot.title")}</h1>
        {sent ? <Notice tone="ok">{t("forgot.sent")}</Notice> : (
          <form action={forgotPasswordAction} className="stack">
            <p className="muted">{t("forgot.help")}</p>
            <label>{t("login.email")}<input name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" required dir="ltr" /></label>
            <SubmitButton className="btn" type="submit">{t("forgot.send")}</SubmitButton>
          </form>
        )}
        <Link href="/login">{t("forgot.back")}</Link>
      </div>
    </main>
  );
}
