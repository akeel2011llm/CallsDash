import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabasePublicKey, supabaseUrl } from "./supabase-env";

export const supabaseConfigured = () => Boolean(supabaseUrl() && supabasePublicKey());

/** Supabase Auth client bound to the request's cookies. Used for sign-in and to identify the user; data goes through lib/data. */
export async function supabaseServer() {
  const jar = await cookies();
  return createServerClient(supabaseUrl()!, supabasePublicKey()!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        // Server components cannot set cookies; the proxy refreshes the session instead.
        try { list.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch { /* ignore */ }
      },
    },
  });
}
