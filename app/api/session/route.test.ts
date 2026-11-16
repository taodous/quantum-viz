// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TokenBucket } from "@/lib/server/rateLimit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

const svc = { loginLimit: new TokenBucket(8, 0.1), pool: { warm: async () => {} } };
vi.mock("@/lib/server/services", () => ({ services: () => svc }));

const { POST } = await import("./route");

/** Development config: the session code is "quantum". */
const login = (code: string, ip = "203.0.113.7") =>
  POST(new NextRequest("http://localhost/api/session", { method: "POST", body: JSON.stringify({ code }), headers: { "x-forwarded-for": ip } }));

beforeEach(() => {
  svc.loginLimit = new TokenBucket(8, 0.1);
});

describe("POST /api/session", () => {
  it("a whole class behind one school IP gets in at once", async () => {
    const statuses = await Promise.all(Array.from({ length: 40 }, () => login("Quantum ").then((r) => r.status)));
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it("sets the signed httpOnly cookie", async () => {
    const res = await login("quantum");
    expect(res.headers.get("set-cookie")).toMatch(/hq_session=.+HttpOnly/i);
  });

  it("wrong codes are limited per IP, and then even the right code waits", async () => {
    for (let i = 0; i < 8; i++) expect((await login("nope")).status).toBe(401);
    const res = await login("nope");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("10");
    expect((await login("quantum")).status).toBe(429);
    expect((await login("quantum", "198.51.100.1")).status).toBe(200); // another IP is not affected
  });
});
