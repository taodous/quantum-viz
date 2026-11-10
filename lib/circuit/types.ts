/** JSON contract produced by the Python runner (runner/qrunner). See CLAUDE.md. */

export type Family = "h" | "pauli" | "rot" | "phase" | "neutral" | "meas";
export type Shape = "box" | "oplus" | "dot" | "swap" | "meter" | "state" | "barrier";

export type Op = {
  name: string;
  label: string;
  family: Family;
  shape: Shape;
  params: string[];
  controls: string[];
  controlValues: number[];
  targets: string[];
  line: number | null;
  group: { id: number; name: string } | null;
  children: Op[] | null;
  caption: string | null;
  cond: boolean;
  extra: number;
};

export type Meas = Op & {
  caps: Record<string, string>;
  joint: boolean;
  obs: string | null;
  all: boolean;
  terminal: true;
};

export type Wire = { key: string; label: string };

export type HistogramBar = { state: string; value: number };

export type Circuit = {
  name: string;
  label: string;
  wires: Wire[];
  ops: Op[];
  meas: Meas[];
  shots: number | null;
  histogram: HistogramBar[] | null;
  histogramKind: "counts" | "probs" | "theory" | null;
};

export type RunError = {
  kind: "syntax" | "runtime" | "pennylane" | "timeout" | "limit" | "infra";
  message: string;
  line: number | null;
  python: string | null;
};

export type RunResponse =
  | { ok: true; circuits: Circuit[]; stdout: string; durationMs: number; hint: string | null }
  | { ok: false; error: RunError; durationMs?: number };

/** A test fixture: student code + what the real runner answered. */
export type Fixture = { name: string; code: string; response: RunResponse };
