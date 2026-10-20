import type { Metadata, Viewport } from "next";
import { getT } from "@/lib/i18n";
import { RegisterSW } from "@/components/RegisterSW";
import "./globals.css";

export const metadata: Metadata = {
  title: "CallsDash",
  description: "AI voice reception dashboard",
  applicationName: "CallsDash",
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "CallsDash", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // use the full screen on phones with a notch; the CSS keeps content inside the safe areas
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0e7c86" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1317" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, dir } = await getT();
  return (
    <html lang={locale} dir={dir}>
      <body>{children}<RegisterSW /></body>
    </html>
  );
}
