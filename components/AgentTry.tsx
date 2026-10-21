"use client";

import { useEffect, useRef, useState } from "react";
import type { TextConversation } from "@elevenlabs/client";

const WIDGET_SCRIPT = "https://unpkg.com/@elevenlabs/convai-widget-embed";

export type TryLabels = Record<
  "language" | "widgetTitle" | "widgetHelp" | "chatTitle" | "chatHelp" | "start" | "suggestions" | "placeholder" | "send" | "newChat"
  | "connecting" | "working" | "ended" | "failed" | "you" | "assistant",
  string
>;

type Lang = "en" | "ar";
type Line = { id: number; who: "user" | "agent" | "note"; text: string };

/**
 * The clinic's real ElevenLabs agent on a dashboard screen, two ways: the website widget exactly as visitors get it
 * (floating in the corner, talk or type), and a written chat like WhatsApp or Instagram. Both use the live knowledge
 * base, calendar and booking tools, so whatever happens here happens for real.
 */
export function AgentTry({ agentId, variables, labels, defaultLanguage, suggestions }: {
  agentId: string; variables: Record<string, string>; labels: TryLabels; defaultLanguage: Lang; suggestions: Record<Lang, string[]>;
}) {
  const [language, setLanguage] = useState<Lang>(defaultLanguage);
  return (
    <div className="stack">
      <label className="row" style={{ alignItems: "center", gap: ".5rem" }}>
        <span>{labels.language}</span>
        <select value={language} onChange={(e) => setLanguage(e.target.value === "ar" ? "ar" : "en")} style={{ inlineSize: "auto" }}>
          <option value="en">English</option>
          <option value="ar">العربية</option>
        </select>
      </label>
      <div className="try-grid">
        <section className="stack" style={{ alignContent: "start" }}>
          <h3 style={{ margin: 0 }}>{labels.chatTitle}</h3>
          <small className="muted">{labels.chatHelp}</small>
          <TextChat key={`${agentId}-${language}`} agentId={agentId} language={language} variables={variables} labels={labels} suggestions={suggestions[language]} />
        </section>
        <aside className="try-widget stack" style={{ alignContent: "start" }}>
          <h3 style={{ margin: 0 }}>{labels.widgetTitle}</h3>
          <small className="muted">{labels.widgetHelp}</small>
          <FloatingWidget key={`${agentId}-${language}`} agentId={agentId} language={language} variables={variables} />
        </aside>
      </div>
    </div>
  );
}

/**
 * ElevenLabs' own embed, the same one public/widget.js puts on the clinic's website. Removed again when the screen is left.
 * It sits in a "dock" the size of the screen above the phone tab bar (app/globals.css), so on a phone its button does not
 * cover the tabs: the dock's transform makes it the box the widget's fixed position is measured from.
 */
function FloatingWidget({ agentId, language, variables }: { agentId: string; language: Lang; variables: Record<string, string> }) {
  const vars = JSON.stringify(variables);
  useEffect(() => {
    if (!document.querySelector(`script[src="${WIDGET_SCRIPT}"]`)) {
      const s = document.createElement("script");
      s.src = WIDGET_SCRIPT;
      s.async = true;
      document.head.appendChild(s);
    }
    const dock = document.createElement("div");
    dock.className = "widget-dock";
    const w = document.createElement("elevenlabs-convai");
    w.setAttribute("agent-id", agentId);
    w.setAttribute("dynamic-variables", vars);
    w.setAttribute("override-language", language);
    dock.appendChild(w);
    document.body.appendChild(dock);
    return () => dock.remove();
  }, [agentId, language, vars]);
  return null;
}

/**
 * A text-only conversation with the agent. A chat that has been quiet for a while is ended by ElevenLabs; the next
 * message then starts a new conversation that is told what was said so far, so a booking can carry on where it stopped.
 */
function TextChat({ agentId, language, variables, labels, suggestions }: {
  agentId: string; language: Lang; variables: Record<string, string>; labels: TryLabels; suggestions: string[];
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "connecting" | "connected">("idle");
  const [waiting, setWaiting] = useState(false);
  const [working, setWorking] = useState(false);
  const conv = useRef<TextConversation | null>(null);
  const history = useRef<Line[]>([]);
  const seq = useRef(0);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => () => { void conv.current?.endSession(); }, []);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [lines, waiting]);

  const add = (who: Line["who"], text: string) => {
    const line = { id: ++seq.current, who, text };
    if (who !== "note") history.current = [...history.current, line];
    setLines((x) => [...x, line]);
  };

  async function connect(): Promise<TextConversation | null> {
    setStatus("connecting");
    const earlier = history.current.map((l) => `${l.who === "user" ? "Patient" : "Assistant"}: ${l.text}`).join("\n");
    try {
      const { Conversation } = await import("@elevenlabs/client");
      const c = await Conversation.startSession({
        agentId,
        connectionType: "websocket",
        textOnly: true,
        dynamicVariables: variables,
        // carrying on after the chat was ended: no second greeting, the conversation continues
        overrides: { agent: { language, ...(earlier ? { firstMessage: "" } : {}) }, conversation: { textOnly: true } },
        onMessage: (m) => {
          const text = m.message?.trim();
          if (!text || m.role === "user") return;
          setWaiting(false);
          setWorking(false);
          add("agent", text);
        },
        onAgentToolRequest: () => setWorking(true),
        onDisconnect: (d) => {
          conv.current = null;
          setStatus("idle");
          setWaiting(false);
          setWorking(false);
          if (d.reason !== "user") add("note", labels.ended);
        },
        onError: (message) => add("note", `${labels.failed} ${message}`),
      });
      conv.current = c;
      if (earlier) c.sendContextualUpdate(`This chat is continuing. Earlier messages in it:\n${earlier.slice(-6000)}`);
      setStatus("connected");
      return c;
    } catch (e) {
      setStatus("idle");
      add("note", `${labels.failed} ${e instanceof Error ? e.message : ""}`.trim());
      return null;
    }
  }

  async function send(message = draft) {
    const text = message.trim();
    if (!text || status === "connecting") return;
    const c = conv.current ?? (await connect());
    if (!c) return; // the message stays in the box to send again
    setDraft("");
    add("user", text);
    setWaiting(true);
    c.sendUserMessage(text);
  }

  async function restart() {
    const c = conv.current;
    conv.current = null;
    history.current = [];
    setLines([]);
    setWaiting(false);
    setWorking(false);
    if (c) await c.endSession();
  }

  const empty = lines.length === 0 && status === "idle";
  return (
    <div className="stack">
      <div ref={log} className={`chat try-chat${empty ? " empty" : ""}`} aria-live="polite">
        {empty && <button type="button" className="btn" onClick={() => void connect()}>{labels.start}</button>}
        {lines.map((l) => l.who === "note"
          ? <small key={l.id} className="muted try-note">{l.text}</small>
          : (
            <div key={l.id} className={`bubble ${l.who === "user" ? "patient" : "agent"}`} dir="auto">
              <small>{l.who === "user" ? labels.you : labels.assistant}</small>
              {l.text}
            </div>
          ))}
        {(status === "connecting" || waiting) && (
          <small className="muted try-typing">{status === "connecting" ? labels.connecting : working ? labels.working : "…"}</small>
        )}
      </div>
      {history.current.length === 0 && suggestions.length > 0 && (
        <div className="try-suggestions" aria-label={labels.suggestions}>
          {suggestions.map((s) => (
            <button key={s} type="button" className="btn small ghost" dir="auto" disabled={status === "connecting"} onClick={() => void send(s)}>{s}</button>
          ))}
        </div>
      )}
      <form className="row try-send" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={labels.placeholder} dir="auto" aria-label={labels.placeholder} />
        <button type="submit" className="btn" disabled={!draft.trim() || status === "connecting"}>{labels.send}</button>
        <button type="button" className="btn ghost" disabled={status === "connecting" || lines.length === 0} onClick={() => void restart()}>{labels.newChat}</button>
      </form>
    </div>
  );
}
