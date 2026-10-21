import { SubmitButton } from "./SubmitButton";

/**
 * A permanent action behind a fold and a tick box: nothing is lost to a stray click. The server action checks
 * `confirm=on` itself, so the box is not only a browser nicety.
 */
export function ConfirmDelete({ action, summary, warning, tick, button, fields }: {
  action: (f: FormData) => Promise<void>;
  summary: string; warning: string; tick: string; button: string;
  fields: Record<string, string>;
}) {
  return (
    <details className="confirm">
      <summary className="muted" style={{ cursor: "pointer" }}>{summary}</summary>
      <form action={action} className="stack" style={{ gap: ".5rem", marginBlockStart: ".5rem" }}>
        {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <small className="muted">{warning}</small>
        <label className="inline"><input type="checkbox" name="confirm" required />{tick}</label>
        <div><SubmitButton className="btn small danger" type="submit">{button}</SubmitButton></div>
      </form>
    </details>
  );
}
