/**
 * Stop every running sandbox of this app's pools (names starting with "qv").
 * Sandboxes stop on their own after 45 min; this frees them now, e.g. after a
 * local dev session or at the end of a workshop.
 *
 *   pnpm sandbox:stop
 */
import { Sandbox } from "@vercel/sandbox";

process.loadEnvFile(".env.local");

const all = await (await Sandbox.list({ namePrefix: "qv", sortBy: "name" })).toArray();
const running = all.filter((s) => s.status === "running" || s.status === "pending");
await Promise.allSettled(running.map(async (s) => (await Sandbox.get({ name: s.name })).stop()));
console.log(running.length ? `stopped: ${running.map((s) => s.name).join(", ")}` : "no running pool sandbox");
