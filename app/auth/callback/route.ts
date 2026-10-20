import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase";
import { safePath } from "@/lib/format";

/** Where the link in a password-reset email lands: it turns the one-time code into a sign-in, then opens the account page. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const next = safePath(url.searchParams.get("next"), "/account");
  if (!supabaseConfigured()) return NextResponse.redirect(new URL("/login", url));
  const sb = await supabaseServer();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const { error } = code
    ? await sb.auth.exchangeCodeForSession(code)
    : tokenHash && type ? await sb.auth.verifyOtp({ type, token_hash: tokenHash }) : { error: new Error("no code") };
  return NextResponse.redirect(new URL(error ? "/login?error=1" : next, url));
}
