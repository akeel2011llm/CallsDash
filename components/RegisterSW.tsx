"use client";

import { useEffect } from "react";

/** Registers the service worker (offline page and faster repeat loads). Production only. */
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
