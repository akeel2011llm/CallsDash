/** Supabase now calls the public key "publishable" (sb_publishable_...); the older name "anon" (a JWT) still works. */
export const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabasePublicKey = () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
