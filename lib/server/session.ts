/**
 * Session code → signed, httpOnly cookie. No accounts, no database: the
 * cookie carries a random session id and an expiry, signed with
 * SESSION_SECRET. Changing SESSION_CODE invalidates every cookie.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "hq_session";
export const SESSION_TTL_S = 12 * 3600; // a school day

export type Session = { sid: string; exp: number };

/** "Qubit 42 " and "qubit42" are the same code: it is read aloud in class. */
export function normalizeCode(code: string): string {
  return code.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function mac(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

export function codeMatches(input: string, expected: string, secret: string): boolean {
  // Compare MACs, not strings: constant time whatever the lengths.
  return timingSafeEqual(mac(secret, `code:${normalizeCode(input)}`), mac(secret, `code:${normalizeCode(expected)}`));
}

function signature(sid: string, exp: number, secret: string, code: string): string {
  const codeId = createHash("sha256").update(normalizeCode(code)).digest("base64url");
  return mac(secret, `v1.${sid}.${exp}.${codeId}`).toString("base64url");
}

export function issueSession(secret: string, code: string, now = Date.now()): { value: string; session: Session } {
  const sid = randomBytes(12).toString("base64url");
  const exp = Math.floor(now / 1000) + SESSION_TTL_S;
  return { value: `${sid}.${exp}.${signature(sid, exp, secret, code)}`, session: { sid, exp } };
}

export function readSession(value: string | undefined, secret: string, code: string, now = Date.now()): Session | null {
  if (!value) return null;
  const [sid, expRaw, sig, ...rest] = value.split(".");
  if (!sid || !expRaw || !sig || rest.length) return null;
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || exp * 1000 <= now) return null;
  const want = Buffer.from(signature(sid, exp, secret, code));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { sid, exp };
}

export function cookieOptions(maxAge = SESSION_TTL_S) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}
