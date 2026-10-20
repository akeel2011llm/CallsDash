"use client";

export function PrintButton({ children }: { children: React.ReactNode }) {
  return <button type="button" className="btn ghost no-print" onClick={() => window.print()}>{children}</button>;
}
