import { requireSection } from "@/lib/auth";

/** Only people allowed to open this part of the portal (lib/access.ts). */
export default async function Section({ children }: { children: React.ReactNode }) {
  await requireSection("customers");
  return <>{children}</>;
}
