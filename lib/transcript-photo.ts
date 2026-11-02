/**
 * The same as placeInTranscript in public/widget.js (the clinic's website), for the dashboard's "Try the assistant" widget:
 * in a spoken call the photo is placed inside the chat's transcript (ElevenLabs' open shadow root), where a typed chat shows it.
 * The widget's markup is not ours and may change, so the transcript is found by what it is (the scrolling box holding the most
 * text); anything unexpected returns false and the caller falls back. Keep the two copies the same.
 */
export const VOICE_NO_CARD = "The photo cannot be shown on this screen. Do not say, spell or write any link or address. Just describe the item, and offer to send the details by message.";

export function placeInTranscript(embed: Element | null, href: string, caption: string | undefined, rtl: boolean): boolean {
  try {
    const root = embed?.shadowRoot;
    if (!root) return false;
    let best: HTMLElement | null = null, bestLen = 0;
    root.querySelectorAll("div").forEach((d) => {
      const cs = getComputedStyle(d);
      if ((cs.overflowY !== "auto" && cs.overflowY !== "scroll") || !d.clientHeight) return;
      const len = (d.textContent || "").length;
      if (len >= bestLen) { best = d; bestLen = len; }
    });
    const box = best as HTMLElement | null;
    if (!box || bestLen < 1) return false;
    let host = box.lastElementChild as HTMLElement | null;
    if (!host || host.tagName !== "DIV" || (host.textContent || "").length < bestLen * 0.8) host = box;
    const card = document.createElement("div");
    card.dataset.callsdashWidget = "transcript-photo";
    card.dir = rtl ? "rtl" : "ltr";
    Object.assign(card.style, { maxWidth: "min(220px, 100%)", margin: "6px 0", alignSelf: rtl ? "flex-end" : "flex-start" });
    const img = document.createElement("img");
    img.src = href;
    img.alt = caption || "";
    Object.assign(img.style, { display: "block", width: "100%", maxHeight: "220px", objectFit: "cover", borderRadius: "10px" });
    card.append(img);
    if (caption) {
      const c = document.createElement("div");
      c.textContent = caption.slice(0, 200);
      Object.assign(c.style, { fontSize: "13px", lineHeight: "1.4", paddingTop: "4px", opacity: ".8" });
      card.append(c);
    }
    host.appendChild(card);
    box.scrollTop = box.scrollHeight;
    img.addEventListener("load", () => { box.scrollTop = box.scrollHeight; });
    return true;
  } catch { return false; }
}
