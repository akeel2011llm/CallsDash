import Link from "next/link";
import type { StepStatus } from "@/lib/steps";
import type { Key } from "@/lib/i18n";
import { Icon } from "./icons";

export interface StepView {
  id: string;
  label: string;
  /** One short line under the label (what the step is for, or why it is skipped/blocked). */
  hint?: string;
  status: StepStatus;
  href?: string;
}

export interface StepperText {
  /** "Step {n} of {total}" */
  of: string;
  status: Record<StepStatus, string>;
}

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

/**
 * The progress header of a guided flow: numbered steps with a tick when done. Every step says its state in words as well as
 * with colour. On a phone it shows "Step 2 of 5" with the step name and a progress bar above a compact row of numbered marks (still links).
 * Server component (no browser code), so it works before the page's scripts load.
 */
export function Stepper({ steps, text, label }: { steps: StepView[]; text: StepperText; label: string }) {
  const total = steps.length;
  const i = Math.max(0, steps.findIndex((s) => s.status === "current"));
  const cur = steps[i];
  const finished = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  return (
    <nav className="stepper" aria-label={label}>
      <div className="stepper-now" aria-hidden="true">
        <strong>{fill(text.of, { n: i + 1, total })}</strong>
        {cur && <span>{cur.label}</span>}
        <span className="stepper-bar"><span style={{ inlineSize: `${total ? Math.round((finished / total) * 100) : 0}%` }} /></span>
      </div>
      <ol>
        {steps.map((s, n) => {
          const body = (
            <>
              <span className="step-mark" aria-hidden="true">
                {s.status === "done" ? <Icon name="tick" size={14} /> : s.status === "skipped" ? "–" : n + 1}
              </span>
              <span className="step-text">
                <span className="step-label">{s.label}</span>
                <small>{s.hint ?? text.status[s.status]}</small>
              </span>
              <span className="sr-only">{` (${text.status[s.status]})`}</span>
            </>
          );
          return (
            <li key={s.id} className={`step ${s.status}`} aria-current={s.status === "current" ? "step" : undefined}>
              {s.href && s.status !== "current" ? <Link href={s.href}>{body}</Link> : <span>{body}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The stepper's words in the person's language (keys steps.* in lib/i18n.ts). */
export function stepperText(t: (k: Key) => string): StepperText {
  return {
    of: t("steps.of"),
    status: {
      done: t("steps.status.done"), current: t("steps.status.current"), todo: t("steps.status.todo"),
      skipped: t("steps.status.skipped"), blocked: t("steps.status.blocked"),
    },
  };
}
