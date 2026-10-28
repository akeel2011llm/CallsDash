"use client";

import { useRef, useState } from "react";

const MAX_SIDE = 1000;

/**
 * A photo picker that shrinks a phone photo (often several MB) to a web-sized JPEG in the browser before it is sent, so staff
 * never meet a "file too large" error. The shrunk picture replaces the chosen file in the form.
 */
export function ItemPhotoInput({ name, label, working, failed }: { name: string; label: string; working: string; failed: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const [preview, setPreview] = useState("");

  async function shrink(file: File) {
    setState("working");
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.fillStyle = "#fff"; // a transparent png would turn black as a jpeg
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (!blob || !input.current) throw new Error("encode");
      const out = new File([blob], "photo.jpg", { type: "image/jpeg" });
      const dt = new DataTransfer();
      dt.items.add(out);
      input.current.files = dt.files;
      setPreview(URL.createObjectURL(out));
      setState("idle");
    } catch {
      if (input.current) input.current.value = "";
      setPreview("");
      setState("failed");
    }
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
