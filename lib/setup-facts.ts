import "server-only";
import * as store from "./data";
import { setupChecklist, type ChecklistItem } from "./checklist";
import { rulesOf } from "./business-types";
import { wizardPhases, type Phase } from "./wizard";
import type { Tenant } from "./types";

async function facts(tenant: Tenant) {
  const [knowledge, doctors, people, convs, agent, wallet, items] = await Promise.all([
    store.getKnowledge(tenant.id), store.getDoctors(tenant.id), store.listProfiles(tenant.id),
    store.getConversations(tenant.id), store.getAgent(tenant.id).catch(() => undefined), store.getWallet(tenant.id),
    store.getItems(tenant.id),
  ]);
  return {
    knowledgeCount: knowledge.length, doctorCount: doctors.length, userCount: people.length, catalogCount: items.length,
    conversationCount: convs.length, agentId: agent?.elevenLabsAgentId ?? "", balance: wallet.balance,
  };
}

/** Reads what the checklist needs and returns its items. */
export async function checklistFor(tenant: Tenant): Promise<ChecklistItem[]> {
  return setupChecklist(tenant, await facts(tenant));
}

/** The checklist grouped into the setup wizard's five phases, with the client's business-type rules applied. */
export async function wizardFor(tenant: Tenant): Promise<{ items: ChecklistItem[]; phases: Phase[]; knowledgeCount: number; catalogCount: number; doctorCount: number }> {
  const f = await facts(tenant);
  const items = setupChecklist(tenant, f);
  return { items, phases: wizardPhases(items, rulesOf(tenant), f), knowledgeCount: f.knowledgeCount, catalogCount: f.catalogCount, doctorCount: f.doctorCount };
}
