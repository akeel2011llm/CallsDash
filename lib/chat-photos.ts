/**
 * In a typed website chat the assistant puts a photo inside its reply as a markdown image, ![caption](url). ElevenLabs' widget
 * draws that itself; the dashboard's written test chat uses this to do the same. Only pictures that `allow` accepts become
 * images; anything else stays as the text it was.
 */
export type ChatPart = { text: string } | { image: string; alt: string };

const IMAGE = /!\[([^\]\n]{0,200})\]\(\s*<?([^)\s>]+)>?\s*\)/g;

export function splitPhotos(message: string, allow: (url: string) => string | null): ChatPart[] {
  const parts: ChatPart[] = [];
  let last = 0;
  const text = (t: string) => { const v = t.replace(/\n{3,}/g, "\n\n").trim(); if (v) parts.push({ text: v }); };
  for (const m of message.matchAll(IMAGE)) {
    const src = allow(m[2]);
    if (!src) continue;
    text(message.slice(last, m.index));
    parts.push({ image: src, alt: m[1].trim() });
    last = m.index + m[0].length;
  }
  text(message.slice(last));
  return parts;
}

/** Keeps photos the assistant puts inside the ElevenLabs chat small, so they read as part of the conversation. */
export const CHAT_PHOTO_CSS = '[data-streamdown="image-wrapper"]{max-width:min(220px,100%)}[data-streamdown="image-wrapper"]>div{width:100%}img[data-streamdown="image"]{display:block;width:100%;max-height:220px;object-fit:cover}';
