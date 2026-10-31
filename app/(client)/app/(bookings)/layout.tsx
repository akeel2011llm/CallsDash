import { ClientTabs } from "@/components/ClientTabs";

/** One menu item, several pages: the tabs of this group above each page (docs/reorganization.md, milestone 6). */
export default function Group({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ClientTabs group="bookings" />
      {children}
    </>
  );
}
