import type { RunError } from "@/lib/circuit/types";

/** The runner writes code between backticks: "`thet` n'est pas défini". */
export function withCode(text: string) {
  return text.split(/`([^`]+)`/).map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));
}

/** Error over the greyed last good circuit: one French sentence, Python's own message folded below. */
export function ErrorCard({ error }: { error: RunError }) {
  return (
    <div className="err-card" role="alert">
      <p>
        {error.line ? <b>Ligne {error.line} · </b> : null}
        {withCode(error.message)}
      </p>
      {error.python ? (
        <details>
          <summary>message Python</summary>
          <pre>{error.python}</pre>
        </details>
      ) : null}
    </div>
  );
}
