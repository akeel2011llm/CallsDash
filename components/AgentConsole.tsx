"use client";

import { useEffect, useRef, useState } from "react";
import type { Conversation } from "@elevenlabs/client";

export type ConsoleLabels = Record<
  "call" | "chat" | "end" | "send" | "placeholder" | "connecting" | "listening" | "speaking" | "connected" | "ended"
  | "volume" | "phoneHint" | "micBlocked" | "failed" | "you" | "agent" | "toolOk" | "toolFailed" | "toolRunning",
  string
>;

type Line = { id: number; who: "user" | "agent" | "tool" | "note"; text: string; ok?: boolean | null; callId?: string };
type Status = "idle" | "connecting" | "connected";
/** The SDK's playback chain (platform/web/output.js): worklet -> gain -> analyser -> <audio>. Not public API, so every use is guarded. */
type Output = { gain?: GainNode; analyser?: AnalyserNode; context?: AudioContext; setVolume?: (v: number) => void };
type AudioSessionNav = Navigator & { audioSession?: { type: string } };

const BOOST_KEY = "callsdash-speaker-boost";
const BOOSTS = [1, 1.5, 2, 3, 4];

/**
 * Talk or chat with a clinic's ElevenLabs agent, with CallsDash's own controls. Replaces ElevenLabs' embedded widget
 * because phones play a call's voice quietly while the microphone is open (the browser switches to "call" audio, and on
 * iPhone that is the earpiece level) and the widget offers no way to raise it. Here the agent's voice goes through an
 * adjustable boost and a limiter, so it is louder on a phone speaker without clipping.
 */
export function AgentConsole({ agentId, language, variables, labels, showTools = false, height = 360 }: {
  agentId: string; language: "en" | "ar"; variables: Record<string, string>; labels: ConsoleLabels; showTools?: boolean; height?: number;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [voice, setVoice] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [boost, setBoost] = useState(2);
  const conv = useRef<Conversation | null>(null);
  const out = useRef<Output | null>(null);
  const seq = useRef(0);
  const log = useRef<HTMLDivElement>(null);
  const pending = useRef<string | null>(null);

  useEffect(() => {
    try { const v = Number(localStorage.getItem(BOOST_KEY)); if (BOOSTS.includes(v)) setBoost(v); } catch { /* private mode: keep the default */ }
    return () => { void conv.current?.endSession(); resetAudioSession(); };
  }, []);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [lines]);

  const add = (l: Omit<Line, "id">) => setLines((x) => {
    // a typed message can come back as the user's transcript as well; show it once
    const last = x[x.length - 1];
    if (l.who === "user" && last?.who === "user" && last.text === l.text) return x;
    return [...x, { ...l, id: ++seq.current }];
  });

  async function start(withVoice: boolean) {
    if (status !== "idle") return;
    setStatus("connecting");
    setVoice(withVoice);
    try {
      const { Conversation } = await import("@elevenlabs/client");
      if (withVoice) setAudioSession("play-and-record");
      const c = await Conversation.startSession({
        agentId,
        connectionType: "websocket",
        textOnly: !withVoice,
        dynamicVariables: variables,
        overrides: { agent: { language }, ...(withVoice ? {} : { conversation: { textOnly: true } }) },
        onMessage: (m) => {
          const text = m.message?.trim();
          if (text) add({ who: (m.role ?? (m.source === "ai" ? "agent" : "user")) === "agent" ? "agent" : "user", text });
        },
        onModeChange: ({ mode }) => setSpeaking(mode === "speaking"),
        onDisconnect: () => { conv.current = null; out.current = null; setStatus("idle"); setSpeaking(false); resetAudioSession(); add({ who: "note", text: labels.ended }); },
        onError: (message) => add({ who: "note", text: `${labels.failed} ${message}` }),
        ...(showTools ? {
          onAgentToolRequest: (r: { tool_name: string; tool_call_id: string }) => add({ who: "tool", text: r.tool_name, ok: null, callId: r.tool_call_id }),
          onAgentToolResponse: (r: { tool_name: string; tool_call_id: string; is_error: boolean; full_tool_result?: string }) => setLines((x) => {
            const failed = r.is_error || /"ok"\s*:\s*false/.test(r.full_tool_result ?? "");
            const detail = (r.full_tool_result ?? "").replace(/\s+/g, " ").slice(0, 300);
            const i = x.findIndex((l) => l.callId === r.tool_call_id);
            const line: Line = { id: i >= 0 ? x[i].id : ++seq.current, who: "tool", text: detail ? `${r.tool_name}: ${detail}` : r.tool_name, ok: !failed, callId: r.tool_call_id };
            return i >= 0 ? x.map((l, j) => (j === i ? line : l)) : [...x, line];
          }),
        } : {}),
      });
      conv.current = c;
      setStatus("connected");
      if (withVoice) applyBoost(c, boost);
      if (pending.current) { c.sendUserMessage(pending.current); pending.current = null; }
    } catch (e) {
      resetAudioSession();
      setStatus("idle");
      const name = e instanceof Error ? e.name : "";
      add({ who: "note", text: name === "NotAllowedError" ? labels.micBlocked : `${labels.failed} ${e instanceof Error ? e.message : ""}` });
    }
  }

  function applyBoost(c: Conversation, v: number) {
    const o = (c as unknown as { output?: Output }).output;
    try {
      if (o?.gain && o.analyser && o.context && o.setVolume) {
        if (out.current !== o) {
          // The boost lifts the whole voice; a limiter after it holds the peaks just under full scale, so it never clips.
          const limiter = o.context.createDynamicsCompressor();
          limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.15;
          o.gain.disconnect();
          o.gain.connect(limiter);
          limiter.connect(o.analyser);
          out.current = o;
        }
        o.setVolume(v);
        return;
      }
    } catch { /* the SDK changed shape: fall back to its own volume */ }
    c.setVolume({ volume: 1 });
  }

  function changeBoost(v: number) {
    setBoost(v);
    try { localStorage.setItem(BOOST_KEY, String(v)); } catch { /* not saved, still applied */ }
    if (conv.current && voice) applyBoost(conv.current, v);
  }

  function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    add({ who: "user", text });
    if (conv.current) conv.current.sendUserMessage(text);
    else { pending.current = text; void start(false); }
  }

  const state = status === "connecting" ? labels.connecting : status === "connected" ? (voice ? (speaking ? labels.speaking : labels.listening) : labels.connected) : "";
  return (
    <div className="agent-console stack">
      <div className="row" style={{ alignItems: "center" }}>
        {status === "idle" ? (
          <>
            <button type="button" className="btn" onClick={() => void start(true)}>{labels.call}</button>
            <button type="button" className="btn ghost" onClick={() => void start(false)}>{labels.chat}</button>
          </>
        ) : (
          <button type="button" className="btn danger" disabled={status === "connecting"} onClick={() => void conv.current?.endSession()}>{labels.end}</button>
        )}
        {state && <span className={`console-state${speaking ? " speaking" : ""}`} aria-live="polite">{state}</span>}
      </div>
      <label className="row" style={{ alignItems: "center", gap: ".5rem" }}>
        <span>{labels.volume}</span>
        <select value={boost} onChange={(e) => changeBoost(Number(e.target.value))}>
          {BOOSTS.map((b) => <option key={b} value={b}>{Math.round(b * 100)}%</option>)}
        </select>
      </label>
      <small className="muted">{labels.phoneHint}</small>
      <div ref={log} className="console-log" style={{ height }} aria-live="polite">
        {lines.map((l) => (
          <div key={l.id} className={`console-line ${l.who}${l.ok === false ? " failed" : ""}`} dir="auto">
            {l.who === "user" && <strong>{labels.you}: </strong>}
            {l.who === "agent" && <strong>{labels.agent}: </strong>}
            {l.who === "tool" && <strong>{l.ok === null ? labels.toolRunning : l.ok ? labels.toolOk : labels.toolFailed} </strong>}
            {l.text}
          </div>
        ))}
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={labels.placeholder} dir="auto" style={{ flex: 1, minWidth: 0 }} />
        <button type="submit" className="btn ghost" disabled={!draft.trim() || status === "connecting"}>{labels.send}</button>
      </form>
    </div>
  );
}

/** Safari 16.4+: declare a two-way call up front, and hand audio back to normal playback afterwards so the page is not left quiet. */
function setAudioSession(type: string) {
  try { const s = (navigator as AudioSessionNav).audioSession; if (s) s.type = type; } catch { /* not supported */ }
}
const resetAudioSession = () => setAudioSession("auto");
