// @vitest-environment node
import { describe, expect, it } from "vitest";

import { TokenBucket } from "./rateLimit";
import { codeMatches, issueSession, normalizeCode, readSession, SESSION_TTL_S } from "./session";

const SECRET = "x".repeat(40);

describe("session code", () => {
  it("ignores case and spaces, as it is read aloud in class", () => {
    expect(normalizeCode(" Qubit 42 ")).toBe("qubit42");
    expect(codeMatches("QUBIT42", "qubit 42", SECRET)).toBe(true);
    expect(codeMatches("qubit43", "qubit42", SECRET)).toBe(false);
    expect(codeMatches("", "qubit42", SECRET)).toBe(false);
  });
});

describe("session cookie", () => {
  const now = Date.UTC(2026, 10, 19, 9);

  it("round-trips", () => {
    const { value, session } = issueSession(SECRET, "qubit42", now);
    expect(readSession(value, SECRET, "qubit42", now + 1000)).toEqual(session);
  });

  it("expires", () => {
    const { value } = issueSession(SECRET, "qubit42", now);
    expect(readSession(value, SECRET, "qubit42", now + SESSION_TTL_S * 1000 + 1)).toBeNull();
  });

  it("dies when the session code or the secret changes", () => {
    const { value } = issueSession(SECRET, "qubit42", now);
    expect(readSession(value, SECRET, "photon7", now)).toBeNull();
    expect(readSession(value, "y".repeat(40), "qubit42", now)).toBeNull();
  });

  it("rejects tampering", () => {
    const { value } = issueSession(SECRET, "qubit42", now);
    const [sid, exp, sig] = value.split(".");
    expect(readSession(`${sid}.${Number(exp) + 3600}.${sig}`, SECRET, "qubit42", now)).toBeNull();
    expect(readSession(`other.${exp}.${sig}`, SECRET, "qubit42", now)).toBeNull();
    expect(readSession(`${value}.x`, SECRET, "qubit42", now)).toBeNull();
    expect(readSession("garbage", SECRET, "qubit42", now)).toBeNull();
    expect(readSession(undefined, SECRET, "qubit42", now)).toBeNull();
  });
});

describe("TokenBucket", () => {
  it("allows a burst, then refills", () => {
    const b = new TokenBucket(3, 1);
    expect([1, 2, 3].map(() => b.take("s", 0).ok)).toEqual([true, true, true]);
    expect(b.take("s", 0)).toEqual({ ok: false, retryAfterS: 1 });
    expect(b.take("s", 1000).ok).toBe(true);
    expect(b.take("other", 0).ok).toBe(true);
  });

  it("stays bounded in memory", () => {
    const b = new TokenBucket(1, 1, 10);
    for (let i = 0; i < 100; i++) b.take(`k${i}`, i);
    // @ts-expect-error private, checked on purpose
    expect(b.buckets.size).toBeLessThanOrEqual(10);
  });
});
