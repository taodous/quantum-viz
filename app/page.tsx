import { Workbench } from "@/components/Workbench";
import { DEFAULT_FIXTURE, FIXTURES } from "@/lib/circuit/fixtures";

export default async function Page({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f } = await searchParams;
  const fixture = (f && FIXTURES[f]) || FIXTURES[DEFAULT_FIXTURE];
  return <Workbench key={fixture.name} fixture={fixture} fixtureNames={Object.keys(FIXTURES)} />;
}
