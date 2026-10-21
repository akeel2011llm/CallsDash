import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { demoMode } from "./lib/demo-flag";
import { supabasePublicKey, supabaseUrl } from "./lib/supabase-env";

/** Keeps the Supabase session fresh on every page request (token refresh needs cookie writes, which pages cannot do). */
export async function proxy(req: NextRequest) {
  const url = supabaseUrl(), key = supabasePublicKey();
  if (demoMode() || !url || !key) return NextResponse.next();
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  // getClaims checks the signed token locally (no round trip to Supabase) and still refreshes an expired session.
  await supabase.auth.getClaims();
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|widget.js|api/webhooks|api/widget|w/|icon.svg|api/brand|sw.js|offline.html|icons).*)"] };
