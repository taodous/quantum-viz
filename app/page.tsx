import { cookies } from "next/headers";

import { Workbench } from "@/components/Workbench";
import { DEFAULT_FIXTURE, FIXTURES } from "@/lib/circuit/fixtures";
import { serverConfig } from "@/lib/server/config";
import { readSession, SESSION_COOKIE } from "@/lib/server/session";

async function hasSession(): Promise<boolean> {
  try {
    const cfg = serverConfig();
    return readSession((await cookies()).get(SESSION_COOKIE)?.value, cfg.sessionSecret, cfg.sessionCode) !== null;
  } catch {
    return false; // misconfigured server: the gate will say so
  }
}

export default async function Page({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  // Development: /?f=07_bell opens a runner fixture (visual checks against the prototype).
  const { f } = await searchParams;
  const fixture = process.env.NODE_ENV !== "production" && f ? FIXTURES[f] : undefined;
  return <Workbench key={fixture?.name} authed={await hasSession()} starter={fixture ?? FIXTURES[DEFAULT_FIXTURE]} restore={!fixture} />;
}
