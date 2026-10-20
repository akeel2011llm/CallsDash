import { Icon } from "./icons";
import { Sparkline } from "./charts";
import { EmptyArt } from "./art";

export function Stat({ label, value, hint, tone, icon, trend, delta }: {
  label: string; value: React.ReactNode; hint?: string; tone?: "warn" | "ok" | "bad"; icon?: string; trend?: number[]; delta?: { text: string; up: boolean };
}) {
  return (
    <div className={`card stat ${tone ?? ""}`}>
      {icon && <span className="chip"><Icon name={icon} size={18} /></span>}
      <span className="muted">{label}</span>
      <strong>{value}</strong>
      {(hint || trend || delta) && (
        <div className="stat-foot">
          <small className="muted">{delta && <span className={`delta ${delta.up ? "up" : "down"}`}>{delta.text} </span>}{hint}</small>
          {trend && trend.length > 1 && <Sparkline values={trend} />}
        </div>
      )}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "ok" | "warn" | "bad" | "neutral" | "info" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Notice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "ok" | "warn" }) {
  return <div className={`notice ${tone}`} role="status">{children}</div>;
}

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

const FLAG_ICON = { emergency: "siren", complaint: "alert", lead: "target" } as const;
/** An icon and a word, never colour alone. */
export function Flag({ kind, children }: { kind: "emergency" | "complaint" | "lead"; children: React.ReactNode }) {
  return <span className={`flag ${kind}`}><Icon name={FLAG_ICON[kind]} size={14} />{children}</span>;
}

/** A friendly empty state: a small illustration and one line. */
export function Empty({ children, kind = "check" }: { children: React.ReactNode; kind?: "check" | "inbox" }) {
  return (
    <div className="empty">
      <EmptyArt kind={kind} />
      <p>{children}</p>
    </div>
  );
}
