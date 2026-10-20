"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 480 }}>
        <h1>Something went wrong</h1>
        <p>The server could not load this page. If this keeps happening, send the support code below to your administrator.</p>
        <p><code>{error.digest ?? "no code"}</code> · <a href="/api/health">setup check</a></p>
        <button onClick={reset} style={{ padding: "8px 14px" }}>Try again</button>
      </div>
    </div>
  );
}
