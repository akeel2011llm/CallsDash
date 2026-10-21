"use client";

import { useEffect, useRef } from "react";

const SCRIPT = "https://unpkg.com/@elevenlabs/convai-widget-embed";

/**
 * The client's real ElevenLabs agent, inside the admin portal. Talking and typing both work: the agent's widget has
 * text input switched on (lib/agent-extras.ts). Re-created when the language changes, so each test starts fresh.
 */
export function AgentTestWidget({ agentId, language, variables }: { agentId: string; language: "en" | "ar"; variables: Record<string, string> }) {
  const box = useRef<HTMLDivElement>(null);
  const vars = JSON.stringify(variables);
  useEffect(() => {
    if (!document.querySelector(`script[src="${SCRIPT}"]`)) {
      const s = document.createElement("script");
      s.src = SCRIPT;
      s.async = true;
      document.head.appendChild(s);
    }
    const w = document.createElement("elevenlabs-convai");
    w.setAttribute("agent-id", agentId);
    w.setAttribute("dynamic-variables", vars);
    w.setAttribute("override-language", language);
    w.setAttribute("variant", "expanded");
    box.current?.appendChild(w);
    return () => w.remove();
  }, [agentId, language, vars]);
  return <div ref={box} />;
}
