import type { Metadata } from "next";
import { getT } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "CallsDash",
  description: "AI voice reception dashboard",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, dir } = await getT();
  return (
    <html lang={locale} dir={dir}>
      <body>{children}</body>
    </html>
  );
}
