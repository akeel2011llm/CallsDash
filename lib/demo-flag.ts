/**
 * Demo sign-in replaces authentication with a cookie, so it is refused on a production build that has a real
 * database attached, even if DEMO_MODE=true is set by mistake.
 */
export const demoMode = () =>
  process.env.DEMO_MODE === "true" && !(process.env.NODE_ENV === "production" && process.env.DATABASE_URL);
