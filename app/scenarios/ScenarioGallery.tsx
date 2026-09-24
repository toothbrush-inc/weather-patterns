"use client";

import { useMemo } from "react";
import Dashboard, { type ScenarioData } from "../Dashboard";
import { SCENARIOS, buildScenario } from "@/lib/scenarios.mjs";

export type GalleryScenario = ScenarioData & { id: string; label: string; expect: string };

export default function ScenarioGallery({ initialId: id, overviewOnly }: { initialId: string; overviewOnly: boolean }) {
  const scenario = useMemo(() => ({ ...buildScenario(id), overviewOnly }) as unknown as GalleryScenario, [id, overviewOnly]);
  return <>
    <section className="panel scenario-controls">
      <h1>Weather scenario gallery</h1>
      <p>Synthetic test data · fixed clock · no collection or changes to saved weather data.</p>
      <label htmlFor="scenario">Scenario ({SCENARIOS.length} available)</label>
      <select id="scenario" value={id} onChange={(e) => { window.location.search = `?scenario=${encodeURIComponent(e.target.value)}`; }}>
        {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <p aria-live="polite"><strong>Expected:</strong> {scenario.expect}</p>
      <p>Clock: {new Date(scenario.nowMs).toISOString()} · Charts use the scenario’s local time.</p>
      <a href={`?scenario=${id}&view=${overviewOnly ? "all" : "overview"}`}>{overviewOnly ? "Show all views, including accuracy and history" : "Show forecast overview"}</a>
    </section>
    <Dashboard key={id} scenario={scenario} />
  </>;
}
