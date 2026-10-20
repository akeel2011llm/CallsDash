"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";

type Deferred = Event & { prompt: () => Promise<void> };

/** "Install app" for browsers that offer it (Android, desktop Chrome and Edge); a short hint on iPhone and iPad. */
export function InstallPrompt({ label, iosHint }: { label: string; iosHint: string }) {
  const [evt, setEvt] = useState<Deferred | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(true);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone);
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as Deferred); };
    const onInstalled = () => { setInstalled(true); setEvt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  if (installed) return null;
  if (evt) return <button type="button" className="btn ghost" onClick={() => { void evt.prompt(); }}><Icon name="install" size={18} />{label}</button>;
  if (ios) return <small className="powered" style={{ paddingBlock: ".3rem" }}>{iosHint}</small>;
  return null;
}
