import { notFound } from "next/navigation";
import ScenarioGallery from "./ScenarioGallery";
import { SCENARIOS } from "@/lib/scenarios.mjs";

export const dynamic = "force-dynamic";

export default async function ScenariosPage({ searchParams }: { searchParams: Promise<{ scenario?: string; view?: string }> }) {
  if (process.env.NODE_ENV === "production" && process.env.WEATHER_SCENARIOS !== "1") notFound();
  const params = await searchParams;
  const id = params.scenario ?? SCENARIOS[0].id;
  if (!SCENARIOS.some((s) => s.id === id)) notFound();
  return <ScenarioGallery initialId={id} overviewOnly={params.view !== "all"} />;
}
