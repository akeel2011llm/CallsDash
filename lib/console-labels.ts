import { dictionaries } from "./i18n";
import type { ConsoleLabels } from "@/components/AgentConsole";

const KEYS = ["call", "chat", "end", "send", "placeholder", "connecting", "listening", "speaking", "connected", "ended",
  "volume", "phoneHint", "micBlocked", "failed", "you", "agent", "toolOk", "toolFailed", "toolRunning"] as const;

/** The agent console's text in one language (the console runs in the browser, so it gets plain strings). */
export function consoleLabels(lang: "en" | "ar"): ConsoleLabels {
  const d = dictionaries[lang];
  return Object.fromEntries(KEYS.map((k) => [k, d[`console.${k}`]])) as ConsoleLabels;
}
