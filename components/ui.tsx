export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "warn" | "ok" }) {
  return (
    <div className={`card stat ${tone ?? ""}`}>
      <span className="muted">{label}</span>
      <strong>{value}</strong>
      {hint && <small className="muted">{hint}</small>}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "ok" | "warn" | "bad" | "neutral" | "info" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Notice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "ok" | "warn" }) {
  return <div className={`notice ${tone}`} role="status">{children}</div>;
}

export function PageHead({ title, actions }: { title: string; actions?: React.ReactNode }) {
  return (
    <header className="page-head">
      <h1>{title}</h1>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}
