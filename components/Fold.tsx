import type { ReactNode } from "react";

/**
 * A card that opens and closes: the title (and a short line under it) always shows, the content opens on a click. Long screens are
 * built from these so a person sees the list of sections first, not every field at once. `open` starts it open, which is right for
 * the section a message just refers to (a saved form, an error). A link to `#id` opens it too (components/FoldControls.tsx).
 */
export function Fold({ id, title, hint, badge, open, tone, children }: {
  id?: string; title: ReactNode; hint?: ReactNode; badge?: ReactNode; open?: boolean; tone?: "danger"; children: ReactNode;
}) {
  return (
    <details className={`card fold${tone === "danger" ? " danger-zone" : ""}`} id={id} open={open}>
      <summary>
        <span className="fold-head">
          <h2>{title}</h2>
          {hint ? <small className="muted">{hint}</small> : null}
        </span>
        {badge ? <span className="fold-badge">{badge}</span> : null}
        <span className="fold-chev" aria-hidden="true" />
      </summary>
      <div className="stack fold-body">{children}</div>
    </details>
  );
}
