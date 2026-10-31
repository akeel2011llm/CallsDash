/**
 * Is a menu link the active one for this address? Shared by the sidebar (components/NavLink.tsx) and the phone's bottom bar
 * (components/ShellFrame.tsx). `also` lists the other addresses a grouped menu item stands for: "Inbox" opens Conversations
 * but stays lit on Needs attention and Messages (milestone 6 of docs/reorganization.md).
 */
export function navActive(path: string, href: string, exact?: boolean, also: string[] = []): boolean {
  const under = (h: string) => path === h || path.startsWith(h + "/");
  if (exact) return path === href;
  return under(href) || also.some(under);
}
