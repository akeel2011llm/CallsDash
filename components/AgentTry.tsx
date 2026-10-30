"use client";

import { useEffect, useRef, useState } from "react";
import type { TextConversation } from "@elevenlabs/client";
import { agentVariables } from "@/lib/agent-context";
import { CHAT_PHOTO_CSS, splitPhotos, type ChatPart } from "@/lib/chat-photos";
import type { Tenant } from "@/lib/types";

const WIDGET_SCRIPT = "https://unpkg.com/@elevenlabs/convai-widget-embed";
const PHONE_REPLY = "Not shown on this screen. Put the photo inside your reply as ![short caption](image_url) on its own line, using the same image_url.";

export type TryLabels = Record<
  "language" | "widgetTitle" | "widgetHelp" | "chatTitle" | "chatHelp" | "start" | "suggestions" | "placeholder" | "send" | "newChat"
  | "connecting" | "working" | "ended" | "failed" | "you" | "assistant",
  string
>;

type Lang = "en" | "ar";
type Line = { id: number; who: "user" | "agent" | "note"; text: string; image?: string; parts?: ChatPart[] };

/** Only pictures this app serves for a catalogue item are drawn, whatever the assistant asks for. */
const catalogueImage = (raw: unknown): string | null => {
  try {
    const u = new URL(String(raw), window.location.origin);
    return u.origin === window.location.origin && /^\/api\/items\/[^/]+\/[^/]+\/image$/.test(u.pathname) ? u.href : null;
  } catch { return null; }
};

/** Photos the assistant puts inside a typed reply are drawn by ElevenLabs' widget; this keeps them small (its shadow root is open). */
function smallChatPhotos(w: Element) {
  try {
    const root = w.shadowRoot;
    if (!root || (root as ShadowRoot & { callsdashPhotos?: boolean }).callsdashPhotos) return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CHAT_PHOTO_CSS);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    (root as ShadowRoot & { callsdashPhotos?: boolean }).callsdashPhotos = true;
  } catch { /* an older browser: photos keep the widget's own size */ }
}

/**
 * The clinic's real ElevenLabs agent on a dashboard screen, two ways: the website widget exactly as visitors get it
 * (floating in the corner, talk or type), and a written chat like WhatsApp or Instagram. Both use the live knowledge
 * base, calendar and booking tools, so whatever happens here happens for real.
 */
export function AgentTry({ agentId, openingHours, labels, defaultLanguage, suggestions }: {
  agentId: string; openingHours: Tenant["openingHours"]; labels: TryLabels; defaultLanguage: Lang; suggestions: Record<Lang, string[]>;
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
          <TextChat key={`${agentId}-${language}`} agentId={agentId} language={language} openingHours={openingHours} labels={labels} suggestions={suggestions[language]} />
        </section>
        <aside className="try-widget stack" style={{ alignContent: "start" }}>
          <h3 style={{ margin: 0 }}>{labels.widgetTitle}</h3>
          <small className="muted">{labels.widgetHelp}</small>
          <FloatingWidget key={`${agentId}-${language}`} agentId={agentId} language={language} openingHours={openingHours} />
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
function FloatingWidget({ agentId, language, openingHours }: { agentId: string; language: Lang; openingHours: Tenant["openingHours"] }) {
  const hours = JSON.stringify(openingHours);
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
    // today, open now and so on are worked out when the widget is put on the screen, not when the page was built
    w.setAttribute("dynamic-variables", JSON.stringify(agentVariables({ openingHours: JSON.parse(hours) }, new Date(), { channel: "website" })));
    w.setAttribute("override-language", language);
    // the show_image tool draws a catalogue photo, as it does on the clinic's website (public/widget.js)
    const card = document.createElement("div");
    card.className = "try-photo";
    card.hidden = true;
    const img = document.createElement("img");
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "\u00d7";
    x.addEventListener("click", () => { card.hidden = true; });
    card.append(img, x);
    w.addEventListener("elevenlabs-convai:call", (event) => {
      const config = (event as CustomEvent).detail?.config;
      if (!config) return;
      smallChatPhotos(w);
      config.clientTools = {
        ...config.clientTools,
        show_image: (p: { image_url?: string; caption?: string }) => {
          const href = catalogueImage(p?.image_url);
          if (!href) return "That picture cannot be shown.";
          // on a phone the chat fills the screen: the assistant writes the photo into its reply instead (as public/widget.js does)
          if (window.matchMedia("(max-width: 700px)").matches) return PHONE_REPLY;
          img.src = href;
          img.alt = p?.caption ?? "";
          card.hidden = false;
          // over the chat, just above its message box (the widget lets us measure it; otherwise the stylesheet's place stands)
          Object.assign(card.style, { insetBlockEnd: "", left: "", right: "" });
          try {
            const box = w.shadowRoot?.querySelector("textarea, input[type=text]")?.getBoundingClientRect();
            const d = dock.getBoundingClientRect();
            if (box && box.top > 120 && box.top < d.bottom) {
              const left = Math.max(8, Math.min(box.left + (box.width - card.offsetWidth) / 2, d.width - card.offsetWidth - 8));
              Object.assign(card.style, { insetBlockEnd: `${Math.round(d.bottom - box.top + 24)}px`, left: `${Math.round(left - d.left)}px`, right: "auto" });
            }
          } catch { /* closed or changed: keep the stylesheet's place */ }
          return "Shown.";
        },
      };
    });
    dock.append(w, card);
    document.body.appendChild(dock);
    return () => dock.remove();
  }, [agentId, language, hours]);
  return null;
}

/**
 * A text-only conversation with the agent. A chat that has been quiet for a while is ended by ElevenLabs; the next
 * message then starts a new conversation that is told what was said so far, so a booking can carry on where it stopped.
 */
function TextChat({ agentId, language, openingHours, labels, suggestions }: {
  agentId: string; language: Lang; openingHours: Tenant["openingHours"]; labels: TryLabels; suggestions: string[];
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
  const gone = useRef(false); // the screen was left while a chat was still connecting
  const greeted = useRef<(() => void) | null>(null);

  useEffect(() => {
    gone.current = false;
    return () => { gone.current = true; void conv.current?.endSession(); };
  }, []);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [lines, waiting]);

  const add = (who: Line["who"], text: string, image?: string) => {
    // a typed reply may carry a photo as a markdown image, as in the website chat
    const parts = who === "agent" && !image ? splitPhotos(text, catalogueImage) : [];
    const line: Line = { id: ++seq.current, who, text, ...(image ? { image } : {}), ...(parts.some((x) => "image" in x) ? { parts } : {}) };
    if (who !== "note") history.current = [...history.current, line];
    setLines((x) => [...x, line]);
  };

  async function connect(): Promise<TextConversation | null> {
    setStatus("connecting");
    const earlier = history.current.map((l) => `${l.who === "user" ? "Patient" : "Assistant"}: ${l.text}`).join("\n");
    // A new chat starts with the assistant's greeting; the first message waits for it, so the chat reads in order.
    const greeting = earlier ? Promise.resolve() : new Promise<void>((resolve) => { greeted.current = resolve; setTimeout(resolve, 3500); });
    try {
      const { Conversation } = await import("@elevenlabs/client");
      const c = await Conversation.startSession({
        agentId,
        connectionType: "websocket",
        textOnly: true,
        dynamicVariables: agentVariables({ openingHours }, new Date(), { channel: "website" }),
        // carrying on after the chat was ended: no second greeting, the conversation continues
        overrides: { agent: { language, ...(earlier ? { firstMessage: "" } : {}) }, conversation: { textOnly: true } },
        onMessage: (m) => {
          const text = m.message?.trim();
          if (!text || m.role === "user") return;
          greeted.current?.();
          greeted.current = null;
          setWaiting(false);
          setWorking(false);
          add("agent", text);
        },
        clientTools: {
          show_image: (p: { image_url?: string; caption?: string }) => {
            const href = catalogueImage(p?.image_url);
            if (!href) return "That picture cannot be shown.";
            add("agent", p?.caption?.trim() ?? "", href);
            return "Shown.";
          },
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
      if (gone.current) { void c.endSession(); return null; }
      conv.current = c;
      if (earlier) c.sendContextualUpdate(`This chat is continuing. Earlier messages in it:\n${earlier.slice(-6000)}`);
      await greeting;
      if (gone.current || conv.current !== c) return null; // left, or ended, while waiting for the greeting
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
            <div key={l.id} className={`bubble ${l.who === "user" ? "patient" : "agent"}`}>
              <small>{l.who === "user" ? labels.you : labels.assistant}</small>
              {l.image && <img src={l.image} alt={l.text} className="try-photo-inline" />}
              {l.parts
                ? l.parts.map((x, i) => "image" in x
                  ? <img key={i} src={x.image} alt={x.alt} className="try-photo-inline" />
                  : <span key={i} dir="auto" style={{ display: "block" }}>{x.text}</span>)
                : l.text && <span dir="auto" style={{ display: "block" }}>{l.text}</span>}
            </div>
          ))}
        {(status === "connecting" || waiting) && (
          <small className="muted try-typing">{status === "connecting" ? labels.connecting : working ? labels.working : "…"}</small>
        )}
      </div>
      {history.current.length === 0 && suggestions.length > 0 && (
        <div className="try-suggestions" role="group" aria-label={labels.suggestions}>
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
