import "server-only";
import * as store from "./data";
import { setupChecklist, type ChecklistItem } from "./checklist";
import type { Tenant } from "./types";

/** Reads what the checklist needs and returns its items. */
export async function checklistFor(tenant: Tenant): Promise<ChecklistItem[]> {
  const [knowledge, doctors, people, convs, agent, wallet] = await Promise.all([
    store.getKnowledge(tenant.id), store.getDoctors(tenant.id), store.listProfiles(tenant.id),
    store.getConversations(tenant.id), store.getAgent(tenant.id).catch(() => undefined), store.getWallet(tenant.id),
  ]);
  return setupChecklist(tenant, {
    knowledgeCount: knowledge.length, doctorCount: doctors.length, userCount: people.length,
    conversationCount: convs.length, agentId: agent?.elevenLabsAgentId ?? "", balance: wallet.balance,
  });
}
