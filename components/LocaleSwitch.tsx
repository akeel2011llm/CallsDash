"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { setLocale } from "@/lib/actions";

export function LocaleSwitch({ locale }: { locale: "en" | "ar" }) {
  const path = usePathname();
  const qs = useSearchParams().toString();
  const next = locale === "en" ? "ar" : "en";
  return (
    <form action={setLocale}>
      <input type="hidden" name="locale" value={next} />
      <input type="hidden" name="returnTo" value={path + (qs ? `?${qs}` : "")} />
      <button className="btn ghost" type="submit" lang={next}>
        {next === "ar" ? "العربية" : "English"}
      </button>
    </form>
  );
}
