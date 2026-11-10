/**
 * POST /api/session { code } → sets the signed session cookie if the code
 * given out in class is right, and warms the sandbox pool for the first run.
 */
import { after, type NextRequest, NextResponse } from "next/server";

import { ConfigError, serverConfig } from "@/lib/server/config";
import { services } from "@/lib/server/services";
import { codeMatches, cookieOptions, issueSession, SESSION_COOKIE } from "@/lib/server/session";

export const maxDuration = 60; // the pool warm-up runs after the response

const clientIp = (req: NextRequest) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";

export async function POST(req: NextRequest) {
  let cfg, svc;
  try {
    cfg = serverConfig();
    svc = services();
  } catch (e) {
    if (e instanceof ConfigError) console.error(`[session] ${e.message}`);
    return NextResponse.json({ ok: false, message: "Le serveur n'est pas configuré. Préviens l'animateur." }, { status: 500 });
  }

  const limited = svc.loginLimit.take(clientIp(req));
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, message: `Trop d'essais. Réessaie dans ${limited.retryAfterS} s.` },
      { status: 429, headers: { "retry-after": String(limited.retryAfterS) } },
    );
  }

  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.slice(0, 200) : "";
  if (!code.trim() || !codeMatches(code, cfg.sessionCode, cfg.sessionSecret)) {
    return NextResponse.json({ ok: false, message: "Ce n'est pas le bon code de séance." }, { status: 401 });
  }

  const { value } = issueSession(cfg.sessionSecret, cfg.sessionCode);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, value, cookieOptions());
  after(() => svc.pool.warm({ waitUntil: (p) => after(() => p) }).catch(() => {}));
  return res;
}
