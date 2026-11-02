import { requireSection } from "@/lib/auth";
import { ClientTabs } from "@/components/ClientTabs";

/** One menu item, several pages: the tabs of this group above each page (docs/reorganization.md, milestone 6). */
export default async function Group({ children }: { children: React.ReactNode }) {
  await requireSection("assistant");
  return (
    <>
      <ClientTabs group="assistant" />
      {children}
    </>
  );
}
