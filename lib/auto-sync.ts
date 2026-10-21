import "server-only";
import { after } from "next/server";
import * as store from "./data";
import { appUrl } from "./app-url";
import { syncAgent } from "./agent-sync";
import { elevenLabsFromEnv } from "./elevenlabs-api";

/**
 * Brings the client's ElevenLabs agent up to date after a change that the agent reads (knowledge, prompt, voices,
 * doctors, hours), so a clinic's edit goes live without waiting for the admin to press Sync. Runs after the response is
 * sent; nothing happens before the agent exists or when the keys are missing. A failure becomes an alert for the admin.
 */
export async function autoSync(tenantId: string, actor: string) {
  const api = elevenLabsFromEnv();
  const tools = process.env.AGENT_TOOLS_SECRET;
  if (!api || !tools) return;
  const url = await appUrl();
  if (!url.startsWith("https://")) return;
  if (!(await store.getAgent(tenantId)).elevenLabsAgentId) return;
  after(async () => {
    try {
      await syncAgent({ api, data: store, appUrl: url, toolsSecret: tools, initSecret: process.env.ELEVENLABS_INIT_SECRET || tools }, tenantId, actor);
    } catch (e) {
      await store.addAlert(tenantId, "warning", `A change was saved but could not be sent to ElevenLabs (${e instanceof Error ? e.message.slice(0, 160) : "error"}). Press Sync on the Channels page.`).catch(() => undefined);
    }
  });
}
