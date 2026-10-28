"use client";

import { useRef, useState } from "react";
import { shrinkPhoto } from "@/lib/image-shrink";

/**
 * A photo picker that shrinks a phone photo (often several MB) to a web-sized JPEG (300 KB or less) in the browser before it is sent, so staff
 * never meet a "file too large" error. The shrunk picture replaces the chosen file in the form.
 */
export function ItemPhotoInput({ name, label, working, failed }: { name: string; label: string; working: string; failed: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const [preview, setPreview] = useState("");

  async function shrink(file: File) {
    setState("working");
    const out = await shrinkPhoto(file);
    if (!out || !input.current) {
      if (input.current) input.current.value = "";
      setPreview("");
      setState("failed");
      return;
    }
    const dt = new DataTransfer();
    dt.items.add(out);
    input.current.files = dt.files;
    setPreview(URL.createObjectURL(out));
    setState("idle");
  }

  return (
    <label>
      {label}
      <input ref={input} type="file" name={name} accept="image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) void shrink(f); }} />
      {state === "working" && <small className="muted">{working}</small>}
      {state === "failed" && <small className="muted" role="alert">{failed}</small>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {preview && <img src={preview} alt="" style={{ maxInlineSize: 200, maxBlockSize: 200, objectFit: "cover", borderRadius: 8 }} />}
    </label>
  );
}
