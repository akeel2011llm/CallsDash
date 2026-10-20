"use client";

import { useEffect, useState } from "react";
import { patternOf, sidebarOf, themeVars } from "@/lib/theme";
import type { Branding } from "@/lib/types";
import { Icon } from "./icons";

type Words = { title: string; body: string; nav: string; stat: string };

/**
 * Live preview of the branding form. It listens to the form it sits next to and draws a small portal with the real CSS,
 * so what the admin sees is what the client gets. Nothing is saved until the form is submitted.
 */
export function BrandingPreview({ formId, initial, words }: { formId: string; initial: Branding; words: Words }) {
  const [b, setB] = useState<Branding>(initial);
  const [logo, setLogo] = useState<string | undefined>(initial.logoUrl || undefined);
  const [cover, setCover] = useState<string | undefined>(initial.coverUrl || undefined);
  const [ar, setAr] = useState(false);

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    let blob: string | undefined, coverBlob: string | undefined;
    const read = () => {
      const f = new FormData(form);
      const s = (k: string) => String(f.get(k) ?? "");
      setB((cur) => ({
        ...cur,
        displayName: s("displayName") || cur.displayName, displayNameAr: s("displayNameAr") || cur.displayNameAr,
        primaryColor: s("primaryColor") || cur.primaryColor, accentColor: s("accentColor") || undefined,
        sidebar: s("sidebar") as Branding["sidebar"], radius: s("radius") as Branding["radius"], font: s("font") as Branding["font"],
        welcome: s("welcome"), welcomeAr: s("welcomeAr"), supportPhone: s("supportPhone"), supportEmail: s("supportEmail"),
        hidePoweredBy: f.get("hidePoweredBy") === "on", pattern: s("pattern") as Branding["pattern"],
      }));
      const cf = f.get("cover");
      if (f.get("removeCover") === "on") setCover(undefined);
      else if (cf instanceof File && cf.size > 0) {
        if (coverBlob) URL.revokeObjectURL(coverBlob);
        coverBlob = URL.createObjectURL(cf);
        setCover(coverBlob);
      } else setCover(initial.coverUrl || undefined);
      const file = f.get("logo");
      if (f.get("removeLogo") === "on") setLogo(undefined);
      else if (file instanceof File && file.size > 0) {
        if (blob) URL.revokeObjectURL(blob);
        blob = URL.createObjectURL(file);
        setLogo(blob);
      } else setLogo(initial.logoUrl || undefined);
    };
    read();
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    return () => {
      form.removeEventListener("input", read);
      form.removeEventListener("change", read);
      if (blob) URL.revokeObjectURL(blob);
      if (coverBlob) URL.revokeObjectURL(coverBlob);
    };
  }, [formId, initial.logoUrl, initial.coverUrl]);

  const name = ar ? b.displayNameAr : b.displayName;
  const welcome = (ar ? b.welcomeAr : b.welcome) || words.body;
  return (
    <div className="stack">
      <div className="seg" style={{ justifySelf: "start" }}>
        <a role="button" tabIndex={0} className={!ar ? "on" : ""} onClick={() => setAr(false)}>English</a>
        <a role="button" tabIndex={0} className={ar ? "on" : ""} onClick={() => setAr(true)}>العربية</a>
      </div>
      <div className="preview" dir={ar ? "rtl" : "ltr"} style={themeVars(b) as React.CSSProperties}>
        <aside className="sidebar" data-style={sidebarOf(b)}>
          <div className="brand">
            <span className="logo">{logo ? <img src={logo} alt="" /> : name.trim().charAt(0)}</span>
            <div><strong>{name}</strong></div>
          </div>
          <nav>
            <span className="nav-link active"><Icon name="home" size={16} />{words.nav}</span>
            <span className="nav-link"><Icon name="chart" size={16} /><span style={{ opacity: .7 }}>···</span></span>
            <span className="nav-link"><Icon name="chat" size={16} /><span style={{ opacity: .7 }}>···</span></span>
          </nav>
          <div className="side-foot">
            {(b.supportPhone || b.supportEmail) && <div className="powered" dir="ltr">{b.supportPhone || b.supportEmail}</div>}
            {!b.hidePoweredBy && <div className="powered">Powered by CallsDash</div>}
          </div>
        </aside>
        <div className="preview-main">
          <section className="hero" data-pattern={patternOf(b) === "none" ? undefined : patternOf(b)} data-cover={cover ? "" : undefined} style={cover ? ({ "--cover": `url("${cover}")` } as React.CSSProperties) : undefined}>
            <div><h1>{words.title}, {name}</h1><p>{welcome}</p></div>
          </section>
          <div className="card stat">
            <span className="chip"><Icon name="chat" size={16} /></span>
            <span className="muted">{words.stat}</span>
            <strong>42</strong>
          </div>
          <div className="row"><span className="btn">{words.nav}</span><span className="btn ghost">···</span></div>
        </div>
      </div>
    </div>
  );
}
