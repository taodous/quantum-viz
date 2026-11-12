/**
 * The fail-safe table of CLAUDE.md, browser side: whatever goes wrong, the
 * circuit panel shows the last valid circuit greyed (with its histogram) and
 * a readable French message over it. One test per row of the table.
 *
 * The runner side of each row (the message itself) is tested in
 * runner/tests/test_errors.py and test_modes.py; the API side in
 * lib/server/run.test.ts. See docs/milestones/05-failsafe.md.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXTURES } from "@/lib/circuit/fixtures";
import type { Circuit, RunError, RunResponse } from "@/lib/circuit/types";

import { RUN_DEBOUNCE_MS } from "./useRun";
import { Workbench } from "./Workbench";

const INFRA_DOWN = "Le serveur d'exécution ne répond pas. Nouvel essai…"; // lib/server/run.ts
const starter = FIXTURES["00_default"];
const hadamard = FIXTURES["03_hadamard"];
const errorOf = (name: string) => (FIXTURES[name].response as { error: RunError }).error;

type Reply = { status?: number; body: RunResponse | string } | "offline";

/** fetch("/api/run") answers `replies` in order (the last one repeats). */
function serve(...replies: Reply[]) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(init.body as string).code);
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (r === "offline") throw new TypeError("Failed to fetch");
      return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
    }),
  );
  return calls;
}

const fail = (error: RunError): RunResponse => ({ ok: false, error, durationMs: 1 });

/** Student code saved in the browser: restoring it at load triggers a run. */
function open(code: string) {
  localStorage.setItem("hello-quantum:code", code);
  return render(<Workbench authed starter={starter} />);
}

const flush = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** The common picture: greyed circuit + greyed histogram + message over them. */
function expectGreyedWithMessage(c: HTMLElement, message: string | RegExp) {
  const view = c.querySelector(".view")!;
  expect(view.classList.contains("stale")).toBe(true);
  expect(view.querySelectorAll(".gate").length).toBeGreaterThan(0); // never blank
  expect(c.querySelector(".histo")?.classList.contains("stale")).toBe(true);
  const card = c.querySelector(".overlay .err-card");
  expect(card?.textContent).toMatch(message);
}

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia;
  Object.defineProperty(document, "fonts", { value: { ready: new Promise(() => {}) }, configurable: true });
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fail-safe: every failure ends on the greyed last circuit + a message", () => {
  it("syntax error (runner): line number, French sentence, Python message folded, line marked in the editor", async () => {
    serve({ body: FIXTURES["e1_syntax"].response });
    const { container } = open(FIXTURES["e1_syntax"].code);
    await flush(RUN_DEBOUNCE_MS + 50);
    expectGreyedWithMessage(container, "Ligne 7 · Parenthèse ( ouverte jamais refermée");
    expect(container.querySelector(".err-card details summary")?.textContent).toBe("message Python");
    expect(container.querySelector(".err-card details")?.hasAttribute("open")).toBe(false);
    expect(container.querySelector(".foot.bad")?.textContent).toBe("Ligne 7 à corriger");
    const marked = container.querySelector(".cm-line.lh-err");
    expect(marked?.textContent).toBe("    qml.Hadamard(wires=0"); // line 7 of the student's code
    expect(container.querySelector(".pill.bad")?.textContent).toBe("code à corriger");
  });

  it("runtime error (runner)", async () => {
    serve({ body: FIXTURES["e3_name"].response });
    const { container } = open(FIXTURES["e3_name"].code);
    await flush(RUN_DEBOUNCE_MS + 50);
    expectGreyedWithMessage(container, "Ligne 7 · thet n'est pas défini (tu voulais dire theta ?)");
  });

  it("PennyLane error (runner)", async () => {
    serve({ body: FIXTURES["e2_wire"].response });
    const { container } = open(FIXTURES["e2_wire"].code);
    await flush(RUN_DEBOUNCE_MS + 50);
    expectGreyedWithMessage(container, errorOf("e2_wire").message.replace(/`/g, ""));
    expect(errorOf("e2_wire").line).toBe(8);
  });

  it("infinite loop (runner timeout)", async () => {
    serve({ body: fail({ kind: "timeout", message: "Exécution interrompue après 5 s : boucle infinie ?", line: null, python: null }) });
    const { container } = open("while True:\n    pass\n");
    await flush(RUN_DEBOUNCE_MS + 50);
    expectGreyedWithMessage(container, "Exécution interrompue après 5 s : boucle infinie ?");
  });

  it("circuit too big (runner limit)", async () => {
    serve({ body: FIXTURES["e4_limit"].response });
    const { container } = open(FIXTURES["e4_limit"].code);
    await flush(RUN_DEBOUNCE_MS + 50);
    expectGreyedWithMessage(container, /Circuit trop grand pour être affiché/);
  });

  it("sandbox unavailable (API 503): says so, then retries by itself", async () => {
    const calls = serve({ status: 503, body: fail({ kind: "infra", message: INFRA_DOWN, line: null, python: null }) }, { body: hadamard.response });
    const { container } = open(hadamard.code);
    await flush(RUN_DEBOUNCE_MS + 50);
    expectGreyedWithMessage(container, INFRA_DOWN);
    expect(container.querySelector(".pill.bad")?.textContent).toBe("serveur indisponible");
    expect(container.querySelector(".foot.bad")).toBeNull(); // not the student's fault
    await flush(2_100);
    await flush(100);
    expect(calls).toHaveLength(2);
    expect(container.querySelector(".err-card")).toBeNull();
    expect(container.querySelector(".view.stale")).toBeNull();
  });

  it("connection lost / unreadable answer (browser): code kept, retried", async () => {
    const calls = serve("offline", { body: "<html>proxy error</html>", status: 502 }, { body: hadamard.response });
    const { container } = open(hadamard.code);
    await flush(RUN_DEBOUNCE_MS + 50);
    expectGreyedWithMessage(container, "Connexion perdue. Ton code est conservé.");
    expect(localStorage.getItem("hello-quantum:code")).toBe(hadamard.code);
    await flush(3_100);
    await flush(100);
    expectGreyedWithMessage(container, "Connexion perdue. Ton code est conservé."); // the 502 page is not JSON
    await flush(3_100);
    await flush(100);
    expect(calls).toHaveLength(3);
    expect(container.querySelector(".err-card")).toBeNull();
  });

  it("rendering bug (browser): previous circuit greyed + « Affichage impossible » (recovery: SafeRender.test.tsx)", async () => {
    const good = (starter.response as { circuits: Circuit[] }).circuits[0];
    const broken: RunResponse = { ok: true, circuits: [{ ...good, ops: [null as never] }], stdout: "", durationMs: 1, hint: null };
    serve({ body: broken });
    const { container: c } = open("code whose answer cannot be drawn");
    expect(c.querySelector(".view .gate")).not.toBeNull(); // the starter circuit, drawn at load
    await flush(RUN_DEBOUNCE_MS + 50);
    expect(c.querySelector(".err-card")?.textContent).toMatch("Affichage impossible pour ce circuit");
    expect(c.querySelector(".err-card summary")?.textContent).toBe("détail");
    expect(c.querySelector(".view.stale")).not.toBeNull(); // the circuit drawn before stays, greyed
    expect(c.querySelector(".view .gate")).not.toBeNull();
    expect(console.error).toHaveBeenCalledWith("[render]", expect.any(TypeError)); // the boundary did catch it
  });

  it("a reload with broken code shows the student's last valid circuit, not the starter", async () => {
    serve({ body: hadamard.response });
    open(hadamard.code);
    await flush(RUN_DEBOUNCE_MS + 50);
    cleanup();

    const calls = serve({ body: FIXTURES["e1_syntax"].response });
    const { container } = open("broken (");
    await flush(RUN_DEBOUNCE_MS + 50);
    expect(calls).toEqual(["broken ("]);
    expectGreyedWithMessage(container, /Parenthèse/);
    expect(container.querySelector(".chip")?.textContent).toBe("circuit()"); // hadamard's tab, not bell()
    expect(container.querySelectorAll(".histo li")).toHaveLength(2);
  });

  it("a reload with unchanged code draws the saved circuit without running it", async () => {
    serve({ body: hadamard.response });
    open(hadamard.code);
    await flush(RUN_DEBOUNCE_MS + 50);
    cleanup();

    const calls = serve({ body: hadamard.response });
    const { container } = open(hadamard.code);
    await flush(RUN_DEBOUNCE_MS + 50);
    expect(calls).toEqual([]);
    expect(container.querySelectorAll(".histo li")).toHaveLength(2);
  });
});
