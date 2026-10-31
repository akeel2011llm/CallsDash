import { requireClient } from "@/lib/auth";
import { businessOf } from "@/lib/business-types";
import { getT, type Key } from "@/lib/i18n";
import { getConversations, getStaffRequests } from "@/lib/data";
import { needsAttention } from "@/lib/flags";
import { Tabs, type TabItem as TabLink } from "./Tabs";

export type ClientGroup = "inbox" | "bookings" | "catalog" | "assistant" | "settings";

/** The menu name of each group (also the tabs' name for screen readers). */
export const GROUP_LABEL: Record<ClientGroup, Key> = { inbox: "nav.inbox", bookings: "nav.bookings", catalog: "nav.catalog", assistant: "nav.yourAssistant", settings: "nav.settings" };

/**
 * The tabs of one client-portal menu group (docs/reorganization.md, milestone 6). Pages keep their addresses; the group's
 * layout puts these tabs above them. A tab the person may not open is left out, and a group with one tab shows none.
 */
export async function ClientTabs({ group }: { group: ClientGroup }) {
  const { tenant, staffRole } = await requireClient();
  const { t } = await getT(tenant);
  const manager = staffRole === "manager";
  const tab = (href: string, label: Key, badge?: number): TabLink => ({ href, label: t(label), ...(badge ? { badge } : {}) });
  let items: TabLink[] = [];
  if (group === "inbox") {
    const [convs, requests] = await Promise.all([getConversations(tenant.id), getStaffRequests(tenant.id)]);
    items = [
      tab("/app/conversations", "nav.conversations"),
      tab("/app/attention", "nav.attention", convs.filter(needsAttention).length),
      tab("/app/messages", "nav.messages", requests.filter((r) => r.status === "open").length),
    ];
  } else if (group === "bookings") {
    items = [
      tab("/app/bookings", "nav.bookings"),
      tab("/app/calendar", "nav.calendarHours"),
      ...(manager && businessOf(tenant).staffScheduling ? [tab("/app/doctors", "nav.doctors")] : []),
    ];
  } else if (group === "catalog") {
    items = [tab("/app/catalogue", "nav.catalogue"), ...(manager && tenant.permissions.dataManager ? [tab("/app/data", "nav.dataPhotos")] : [])];
  } else if (group === "assistant") {
    items = [tab("/app/knowledge", "nav.knowledge"), tab("/app/agent", "nav.agent"), tab("/app/voice", "nav.voice"), tab("/app/website", "nav.website")];
  } else {
    items = [tab("/app/settings", "nav.account"), ...(manager ? [tab("/app/team", "nav.team")] : [])];
  }
  return items.length > 1 ? <Tabs label={t(GROUP_LABEL[group])} items={items} /> : null;
}
