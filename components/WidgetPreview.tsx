"use client";

import { useEffect } from "react";

/**
 * The website widget (public/widget.js) running on the Website screen, as it does on the clinic's site. The script puts a
 * launcher on the page, so it is taken off again when the screen is left; otherwise it would stay over the other screens.
 */
export function WidgetPreview({ tenant }: { tenant: string }) {
  useEffect(() => {
    const s = document.createElement("script");
    s.src = "/widget.js";
    s.async = true;
    s.dataset.tenant = tenant;
    s.dataset.preview = "1";
    document.body.appendChild(s);
    return () => {
      s.remove();
      document.querySelectorAll("[data-callsdash-widget]").forEach((n) => n.remove());
      (window as unknown as { __callsdashWidget?: boolean }).__callsdashWidget = false;
    };
  }, [tenant]);
  return null;
}
