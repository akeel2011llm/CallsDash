import { redirect } from "next/navigation";

/** The Billing menu item opens its first tab. */
export default function Billing() {
  redirect("/admin/billing/packages");
}
