"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refreshes the page's server data every `seconds` while it is shown, at most `times` times (for results still coming in). */
export function AutoRefresh({ seconds = 5, times = 36 }: { seconds?: number; times?: number }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const timer = setInterval(() => {
      if (++n > times) return clearInterval(timer);
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds, times]);
  return null;
}
