/**
 * POST /api/run { code } → RunResponse.
 *
 * 200: the runner answered (a mistake in the student's code is a normal
 * answer, ok: false). 401: no valid session cookie. 429: too many runs.
 * 503: no sandbox could run the code. Every body is a RunResponse.
 *
 * Student code never runs here: it goes to a Vercel Sandbox (lib/server/pool).
 */
import { after, type NextRequest, NextResponse } from "next/server";

import { ConfigError, serverConfig } from "@/lib/server/config";
import { MAX_CODE_CHARS, runError, runOnPool } from "@/lib/server/run";
import { services } from "@/lib/server/services";
import { readSession, SESSION_COOKIE } from "@/lib/server/session";

export const maxDuration = 60; // a cold pool takes a few seconds to start

const reply = (status: number, body: unknown, headers?: Record<string, string>) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

export async function POST(req: NextRequest) {
  let cfg, svc;
  try {
    cfg = serverConfig();
    svc = services();
  } catch (e) {
    console.error(`[run] ${e instanceof ConfigError ? e.message : e}`);
    return reply(503, runError("infra", "Le serveur d'exécution n'est pas configuré. Préviens l'animateur."));
  }

  const session = readSession(req.cookies.get(SESSION_COOKIE)?.value, cfg.sessionSecret, cfg.sessionCode);
  if (!session) return reply(401, runError("infra", "Saisis le code de séance pour exécuter ton code."));

  const limited = svc.runLimit.take(session.sid);
  if (!limited.ok) {
    return reply(429, runError("limit", "Trop d'exécutions d'affilée : attends quelques secondes."), { "retry-after": String(limited.retryAfterS) });
  }

  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  if (typeof body?.code !== "string") return reply(400, runError("infra", "Requête invalide"));
  if (body.code.length > MAX_CODE_CHARS) return reply(200, runError("limit", `Code trop long (${MAX_CODE_CHARS} caractères au maximum)`));

  try {
    const result = await runOnPool(svc.pool, body.code, { signal: req.signal, waitUntil: (p) => after(() => p) });
    return reply(result.status, result.body);
  } catch (e) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("[run]", e);
    return reply(503, runError("infra", "Le serveur d'exécution ne répond pas. Nouvel essai…"));
  }
}
