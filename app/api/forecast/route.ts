import { NextResponse } from "next/server";
// @ts-ignore - plain ESM lib modules
import { resolveLocation } from "@/lib/config.mjs";
import { withScope } from "@/lib/request-scope";
// @ts-ignore
import { collectForecasts, forecastsForDate, forecastSourcesFor, forecastConsensus, hourlyForDate } from "@/lib/forecast.mjs";
// @ts-ignore
import { historyStats, buildAlerts, fetchAqiForecastToday, fetchNwsAdvisories } from "@/lib/alerts.mjs";
// @ts-ignore
import { SOURCE_LABELS, SOURCE_COLORS } from "@/lib/constants.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Live daily forecast (high/low) for one location, compared across the
// forecast-capable sources, with a consensus — plus the hour-by-hour merged
// forecast (today chart) and the day's heads-up alerts (anything outside this
// location's normal, and official NWS advisories). Fetched on demand — not stored.
// ?loc=<id> selects the location; omitted → the caller's active location.
export async function GET(req: Request) {
  const loc = new URL(req.url).searchParams.get("loc") || undefined;
  return withScope(req, async ({ cfg }) => {
  const location = resolveLocation(cfg, loc);
  if (!location) return NextResponse.json({ error: "no location" }, { status: 404 });
  const sources = forecastSourcesFor();

  // The AQI forecast and NWS advisories are best-effort extras — either failing
  // (non-US point, API down) must not take the forecast itself with it.
  const [fcRes, aqRes, advRes] = await Promise.allSettled([
    collectForecasts(location),
    fetchAqiForecastToday(location),
    fetchNwsAdvisories(location),
  ]);
  if (fcRes.status === "rejected") throw fcRes.reason;
  const { results, today, tomorrow } = fcRes.value;

  const forecasts = forecastsForDate(results, today);
  const consensus = forecastConsensus(forecasts);
  // Tomorrow rides along from the same fetch — the sources return a week of
  // dailies; until now only the accuracy logger looked past today.
  const tomorrowForecasts = tomorrow ? forecastsForDate(results, tomorrow) : null;
  const hourly = hourlyForDate(results, today);
  const aq = aqRes.status === "fulfilled" ? aqRes.value : null;
  if (aq) hourly.hours.forEach((h: any) => { h.aqi = aq.byHour[h.hour] ?? null; });

  const offsetSec = (results as any).open_meteo?.utc_offset_seconds ?? 0;
  const stats = historyStats(location.id, { offsetSec });
  const alerts = [
    ...(advRes.status === "fulfilled" ? advRes.value : []),
    ...buildAlerts({ consensus, forecasts, hours: hourly.hours, aqiToday: aq, stats }),
  ];

  return NextResponse.json({
    location,
    date: today,
    utc_offset_seconds: offsetSec,
    sources,
    sourceLabels: SOURCE_LABELS,
    sourceColors: SOURCE_COLORS,
    forecasts,
    consensus,
    tomorrow: tomorrowForecasts
      ? { date: tomorrow, forecasts: tomorrowForecasts, consensus: forecastConsensus(tomorrowForecasts) }
      : null,
    hourly,
    hourlyTomorrow: tomorrow ? hourlyForDate(results, tomorrow) : null,
    alerts,
  });
  });
}
