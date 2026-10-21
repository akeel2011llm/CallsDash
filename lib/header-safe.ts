/**
 * Whether a setting can travel in an HTTP header: visible ASCII only, no spaces or line breaks. A secret pasted with a
 * curly quote, a hidden character or a trailing space looks fine on screen but every request that carries it fails
 * ("Cannot convert argument to a ByteString"), so it is checked up front and the page says what to fix.
 */
export const headerSafe = (v: string | undefined): boolean => Boolean(v) && /^[\x21-\x7e]+$/.test(v!);

/** Settings that are sent in a header; each must pass headerSafe. */
export const HEADER_SETTINGS = ["AGENT_TOOLS_SECRET", "ELEVENLABS_INIT_SECRET", "ELEVENLABS_API_KEY"] as const;

/** The first header-carried setting that is set but not safe to send, or undefined. Never returns a value. */
export const badHeaderSetting = (env: Record<string, string | undefined> = process.env): (typeof HEADER_SETTINGS)[number] | undefined =>
  HEADER_SETTINGS.find((k) => env[k] !== undefined && env[k] !== "" && !headerSafe(env[k]));
