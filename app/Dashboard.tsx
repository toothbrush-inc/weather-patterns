"use client";

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import HistoryCharts from "./HistoryCharts";
import AccuracyCharts from "./AccuracyCharts";
import { fitCurve, adjustedDailyRange, breachAt, comparableBounds, consensusBiasFor, forecastCurve, nowVsExpected, NOWCHECK_TOL, type ObsFrame } from "../lib/forecast-adjustment";
import TodayChart from "./TodayChart";
import { WeatherClock, useWeatherNow } from "./WeatherClock";
import {
  NearbySensorPicker,
  PlaceSearch,
  PurpleAirKeyField,
  SetupCard,
  clearForceSetupQuery,
  readForceSetup,
  readSetupSkipped,
  useNearbySensors,
  type GeoResult,
} from "./location-setup";
// @ts-ignore - plain ESM lib module
import { needsFirstRunSetup } from "@/lib/first-run.mjs";
import { RAIN_PROB } from "@/lib/constants.mjs";

// Next rewrites its own routes and assets for basePath, but not fetch strings —
// these have to carry the prefix themselves.
const API = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api`;

// The location being viewed is a per-browser preference, not shared state: it
// lives in the URL (?loc=) and localStorage so a reload or bookmark keeps it.
// Signed in under the platform it is also saved server-side per user, so other
// devices pick it up. It never moves the instance-wide active location.
const LOC_KEY = "weather-compare:loc";
function readRememberedLoc(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get("loc");
    if (q) return q;
    return localStorage.getItem(LOC_KEY);
  } catch {
    return null;
  }
}
function rememberLoc(id: string) {
  try {
    localStorage.setItem(LOC_KEY, id);
  } catch {
    /* private mode */
  }
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("loc") === id) return;
    url.searchParams.set("loc", id);
    window.history.replaceState(null, "", url);
  } catch {
    /* not in a browser */
  }
}

type Reading = {
  ts: string;
  source: string;
  temp_f: number | null;
  humidity: number | null;
  wind_mph: number | null;
  pressure_inhg: number | null;
  pm25: number | null;
  aqi: number | null;
  conditions: string | null;
  place: string | null;
  lat: number | null;
  lon: number | null;
  distance_mi: number | null;
  source_url: string | null;
  status: string;
};

type LocationCfg = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  purpleair_sensor_index?: string;
};

type Payload = {
  location: LocationCfg;
  locations: LocationCfg[];
  activeLocationId: string;
  // Who the platform says we are (lib/identity.mjs), null on a lone instance.
  caller?: { id: string } | null;
  keys: { purpleair: boolean };
  generated: string;
  totalReadings: number;
  sources: string[];
  sourceLabels: Record<string, string>;
  sourceColors: Record<string, string>;
  metricLabels: Record<string, string>;
  metrics: string[];
  latest: Record<string, Reading>;
  history: Reading[];
  outliers: Record<string, number>;
  comparisons: number;
  sourceStatus: Record<string, boolean>;
};
// What /api/data actually sends: `location` is null for a signed-in caller who
// follows nothing yet (the setup card takes over); everything else renders
// from a Payload, so the null is handled once, at the top.
type PayloadWire = Omit<Payload, "location"> & { location: LocationCfg | null };

type Forecast = {
  high_f: number | null;
  low_f: number | null;
  status: string;
  error?: string | null;
  source_url?: string | null;
  conditions?: string | null;
  precip_prob?: number | null;
  precip_in?: number | null;
};

type Consensus = {
  high_f: number | null;
  low_f: number | null;
  high_spread: number | null;
  low_spread: number | null;
  precip_prob?: number | null;
  precip_in?: number | null;
  conditions?: string | null;
};

type HourlyRow = {
  hour: number;
  temp_f: number | null;
  by?: Record<string, number>;
  precip_prob: number | null;
  precip_in?: number | null;
  wind_mph: number | null;
  gust_mph: number | null;
  aqi?: number | null;
  conditions?: string | null;
  is_day?: boolean | null;
};

type EventAlert = {
  kind: string;
  severity: "warning" | "notice";
  icon: string;
  headline: string;
  detail: string | null;
};

type ForecastPayload = {
  location: LocationCfg;
  date: string | null;
  utc_offset_seconds?: number | null;
  sources: string[];
  sourceLabels: Record<string, string>;
  sourceColors: Record<string, string>;
  forecasts: Record<string, Forecast>;
  consensus: Consensus;
  tomorrow?: { date: string | null; forecasts: Record<string, Forecast>; consensus: Consensus } | null;
  hourly?: { date: string; hours: HourlyRow[] } | null;
  hourlyTomorrow?: { date: string; hours: HourlyRow[] } | null;
  alerts?: EventAlert[];
};

type AccStat = { mae: number; bias: number; n: number } | null;
type AccSource = {
  source: string;
  days: number;
  vsOwn: { high: AccStat; low: AccStat };
  vsPurpleair: { high: AccStat; low: AccStat };
  obsGap: { high: number | null; low: number | null } | null;
};
type HiLo = { high_f: number | null; low_f: number | null } | null;
type AccProvisional = {
  source: string;
  forecast: HiLo;
  observedSoFar: HiLo;
  purpleairSoFar: HiLo;
};
type AccDayErr = {
  forecastHigh: number | null; forecastLow: number | null;
  ownHigh: number | null; ownLow: number | null;
  highErrOwn: number | null; lowErrOwn: number | null;
  highErrPa: number | null; lowErrPa: number | null;
};
type AccDaily = {
  date: string;
  actualHigh: number | null;
  actualLow: number | null;
  paHigh: number | null;
  paLow: number | null;
  sources: Record<string, AccDayErr>;
};
type AccDiurnal = {
  estHigh: number | null;
  pctToPeak: number | null;
  tNow: number | null;
  todayMaxSoFar: number | null;
  projCurve?: (number | null)[] | null;
  peakHour: number | null;
  troughHour: number | null;
  nowHour: number | null;
  profileDays: number;
  source: string;
} | null;
type Yesterday = { date: string; high_f: number | null; low_f: number | null; source: string } | null;
type YesterdayAt = { date: string; temp: number | null; hour: number; source: string } | null;
type AccuracyPayload = {
  location: LocationCfg;
  windowDays: number;
  todayLocal: string;
  yesterday: Yesterday;
  yesterdayAtTime: YesterdayAt;
  scoredDays: number;
  forecastsLogged: number;
  hasPurpleair: boolean;
  ownActualSource: Record<string, string>;
  perSource: AccSource[];
  provisional: AccProvisional[];
  daily: AccDaily[];
  diurnal: AccDiurnal;
};

// A reading more than ~15 mi from its location is effectively a different area
// (microclimates, marine layer): green ≤8, amber ≤15, red + banner beyond that.
const AREA_NEAR_MI = 8;
const AREA_FAR_MI = 15;

const SPREAD_THRESHOLDS: Record<string, [number, number]> = {
  temp_f: [2, 5], humidity: [8, 20], wind_mph: [3, 8],
  pressure_inhg: [0.05, 0.15], pm25: [5, 15], aqi: [15, 40],
};

function fmt(v: number | null | undefined) {
  return v === null || v === undefined || Number.isNaN(v) ? "—" : v;
}

// Warm-tone icon: 🔥 only when it's genuinely hot (≥ HOT_F), else ☀️ for merely
// warmer. (Cool always uses ❄️.)
const HOT_F = 85;
const warmIcon = (tempF: number | null | undefined) => (tempF != null && tempF >= HOT_F ? "🔥" : "☀️");

// Sky icon for a forecast conditions string (NWS shortForecast / Open-Meteo WMO
// label). Precipitation only earns the icon when it's actually likely: NWS
// writes "Slight Chance Drizzle then Mostly Sunny" for a 15% day, and a 🌧️ for
// that misleads at a glance — the "% rain" text beside it already covers the
// long shot. A known probability decides — the same RAIN_PROB the heads-up card
// fires at, so icon and card always agree; with none, NWS's own hedges ("Slight
// Chance", "Chance", "Isolated", "Scattered") read as unlikely.
function condIcon(c?: string | null, precipProb?: number | null): string {
  const s = (c || "").toLowerCase();
  const wet = /thunder|t-?storm|snow|sleet|flurr|ice|rain|shower|drizzle/.test(s);
  const likely = precipProb != null ? precipProb >= RAIN_PROB : wet && !/chance|isolated|scattered/.test(s);
  if (likely) {
    if (/thunder|t-?storm/.test(s)) return "⛈️";
    if (/snow|sleet|flurr|ice/.test(s)) return "🌨️";
    return "🌧️";
  }
  if (/fog|mist|haze|smoke/.test(s)) return "🌫️";
  if (/overcast/.test(s)) return "☁️";
  if (/cloud|partly/.test(s)) return "⛅";
  if (/clear|sunny/.test(s)) return "☀️";
  return wet ? "⛅" : "🌤️"; // unlikely showers with no sky words: call it cloudy
}

// "45% rain · ~0.1″" — whichever parts are worth saying; null on a dry day.
function precipLabel(prob: number | null | undefined, inches: number | null | undefined): string | null {
  const inTxt = inches != null && inches >= 0.01 ? `~${inches}″` : null;
  if (prob == null || prob < 5) return inTxt ? `${inTxt} rain` : null;
  return `${prob}% rain${inTxt ? ` · ${inTxt}` : ""}`;
}

// Compact "how long ago" for a reading's timestamp (exact time shown on hover).
function relTime(ts: string, nowMs = Date.now()): string {
  const m = Math.round((nowMs - new Date(ts).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function locLabel(row?: Reading): string {
  if (!row) return "—";
  if (row.place) return row.place;
  if (row.lat != null && row.lon != null) return `${row.lat.toFixed(2)}, ${row.lon.toFixed(2)}`;
  return "—";
}

function distClass(d: number | null | undefined): string {
  if (d == null) return "";
  return d <= AREA_NEAR_MI ? "lo" : d <= AREA_FAR_MI ? "mid" : "hi";
}

function pillLabel(source: string, on: boolean, keys: Payload["keys"]): string {
  if (on) return "on";
  if (source === "purpleair") return keys.purpleair ? "no sensor here" : "no key";
  return "off";
}

export type ScenarioData = { nowMs: number; data: Payload; forecast: ForecastPayload | null; accuracy: AccuracyPayload | null; overviewOnly?: boolean };

export default function Dashboard({ scenario }: { scenario?: ScenarioData }) {
  return <WeatherClock nowMs={scenario?.nowMs}><DashboardContent scenario={scenario} /></WeatherClock>;
}

function DashboardContent({ scenario }: { scenario?: ScenarioData }) {
  const [wire, setData] = useState<PayloadWire | null>(scenario?.data ?? null);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [panel, setPanel] = useState<"locations" | "keys" | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedLoc, setSelectedLoc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [forecast, setForecast] = useState<ForecastPayload | null>(scenario?.forecast ?? null);
  const [fcLoading, setFcLoading] = useState(!scenario);
  const [accuracy, setAccuracy] = useState<AccuracyPayload | null>(scenario?.accuracy ?? null);
  const [accLoading, setAccLoading] = useState(!scenario);
  const [setupSkipped, setSetupSkipped] = useState(false);
  const [forceSetup, setForceSetup] = useState(false);
  const [setupDone, setSetupDone] = useState(false);

  // Forecast is live (not from stored history), so it loads independently of the
  // main dashboard data and gets its own loading state.
  const loadForecast = useCallback(async (loc?: string | null) => {
    setFcLoading(true);
    try {
      const url = loc ? `${API}/forecast?loc=${encodeURIComponent(loc)}` : `${API}/forecast`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`/api/forecast returned ${res.status}`);
      setForecast(await res.json());
    } catch {
      setForecast(null);
    } finally {
      setFcLoading(false);
    }
  }, []);

  // Accuracy reads the forecast log + history and fetches the Open-Meteo archive.
  const loadAccuracy = useCallback(async (loc?: string | null) => {
    setAccLoading(true);
    try {
      const url = loc ? `${API}/accuracy?loc=${encodeURIComponent(loc)}` : `${API}/accuracy`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`/api/accuracy returned ${res.status}`);
      setAccuracy(await res.json());
    } catch {
      setAccuracy(null);
    } finally {
      setAccLoading(false);
    }
  }, []);

  const load = useCallback(async (loc?: string | null) => {
    setLoading(true);
    try {
      const url = loc ? `${API}/data?loc=${encodeURIComponent(loc)}` : `${API}/data`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`/api/data returned ${res.status}`);
      const payload: PayloadWire = await res.json();
      setData(payload);
      setSelectedLoc(payload.location?.id ?? null);
      // A remembered id this caller can no longer see (unfollowed, retired)
      // falls back server-side; keep this browser in step with what it got.
      if (loc && payload.location && payload.location.id !== loc) rememberLoc(payload.location.id);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (scenario) return;
    const loc = readRememberedLoc();
    load(loc);
    loadForecast(loc);
    loadAccuracy(loc);
  }, [load, loadForecast, loadAccuracy, scenario]);
  useEffect(() => {
    if (scenario) return;
    setSetupSkipped(readSetupSkipped());
    setForceSetup(readForceSetup());
  }, []);

  const reload = useCallback(() => load(selectedLoc), [load, selectedLoc]);

  // Switching the viewed location is a personal choice: remembered in this
  // browser and, when the platform knows who we are, saved to our own
  // server-side preferences. It never moves the instance's shared active
  // location — that used to be the side effect that changed everyone's default.
  const signedIn = Boolean(wire?.caller);
  const selectLocation = useCallback(async (id: string) => {
    if (scenario) return;
    setSelectedLoc(id);
    rememberLoc(id);
    if (signedIn) {
      try {
        await fetch(`${API}/locations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "select", id }),
        });
      } catch { /* selection is best-effort */ }
    }
    await Promise.all([load(id), loadForecast(id), loadAccuracy(id)]);
  }, [scenario, signedIn, load, loadForecast, loadAccuracy]);

  const collectNow = useCallback(async () => {
    setCollecting(true);
    try {
      const res = await fetch(`${API}/collect`, { method: "POST" });
      if (!res.ok) throw new Error(`/api/collect returned ${res.status}`);
      await Promise.all([load(selectedLoc), loadForecast(selectedLoc), loadAccuracy(selectedLoc)]);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setCollecting(false);
    }
  }, [load, loadForecast, loadAccuracy, selectedLoc]);

  if (loading && !wire) return <p className="empty">Loading…</p>;
  if (err && !wire) return <p className="empty">Error: {err}. Is the dev server running?</p>;
  if (!wire) return null;

  if (!wire.location) {
    // Signed in and following nothing yet: the setup card is the whole page.
    // "Not now" opens the Locations panel instead, which handles an empty list.
    return (
      <>
        <div className="topbar">
          <h1>Weather Patterns</h1>
        </div>
        {panel === "locations" ? (
          <LocationsPanel
            data={wire as Payload}
            onClose={() => setPanel(null)}
            onChanged={reload}
            onSelect={selectLocation}
          />
        ) : (
          <SetupCard
            locationId=""
            mode="add"
            hasPurpleairKey={wire.keys.purpleair}
            onDone={async (id) => {
              setSetupDone(true);
              setSelectedLoc(id);
              rememberLoc(id);
              await Promise.all([load(id), loadForecast(id), loadAccuracy(id)]);
            }}
            onSkip={() => setPanel("locations")}
          />
        )}
      </>
    );
  }
  const data = wire as Payload;

  const { sources, latest, sourceLabels } = data;
  const hasAnyData = Object.keys(latest).length > 0;
  const showSetup = !scenario && (forceSetup || needsFirstRunSetup(data)) && !setupSkipped && !setupDone;
  const farSources = sources
    .map((s) => latest[s])
    .filter((row): row is Reading => !!row && row.distance_mi != null && row.distance_mi > AREA_FAR_MI);

  return (
    <>
      <div className="topbar">
        <h1>Weather Patterns</h1>
        <select
          className="loc-select header-location"
          aria-label="Weather location"
          disabled={!!scenario}
          value={selectedLoc ?? data.location.id}
          onChange={(e) => selectLocation(e.target.value)}
        >
          {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        {!scenario && <button
          className={`btn secondary${showSettings ? " active" : ""}`}
          onClick={() => setShowSettings((s) => !s)}
          aria-expanded={showSettings}
        >
          ⚙ Settings
        </button>}
      </div>

      {showSettings && (
        <div className="settings-bar panel">
          <div className="sb-row">
            <div className="actions">
              <button
                className={`btn secondary${panel === "locations" ? " active" : ""}`}
                onClick={() => setPanel((p) => (p === "locations" ? null : "locations"))}
              >
                📍 Locations
              </button>
              <button
                className={`btn secondary${panel === "keys" ? " active" : ""}`}
                onClick={() => setPanel((p) => (p === "keys" ? null : "keys"))}
              >
                ⚙ Keys
              </button>
              <button className="btn" onClick={collectNow} disabled={collecting}>
                {collecting ? "Fetching…" : "↻ Collect now"}
              </button>
            </div>
          </div>
          <div className="sb-meta">
            {data.location.lat}, {data.location.lon} · {data.totalReadings} readings logged
            {data.history.length > 0 && (
              <> · latest {new Date(data.history[data.history.length - 1].ts).toLocaleString()}</>
            )}
          </div>
          <div className="statusrow">
            {Object.entries(data.sourceStatus).map(([s, on]) => (
              <span key={s} className={`pill ${on ? "on" : "off"}`}>
                {sourceLabels[s] || s}: {pillLabel(s, on, data.keys)}
              </span>
            ))}
          </div>
        </div>
      )}

      {panel === "locations" && (
        <LocationsPanel
          data={data}
          onClose={() => setPanel(null)}
          onChanged={reload}
          onSelect={selectLocation}
        />
      )}
      {panel === "keys" && <KeysPanel onClose={() => setPanel(null)} onSaved={reload} />}

      {showSetup ? (
        <SetupCard
          locationId={data.location.id}
          mode={needsFirstRunSetup(data) ? "update" : "add"}
          hasPurpleairKey={data.keys.purpleair}
          onDone={async (id) => {
            setSetupDone(true);
            setForceSetup(false);
            clearForceSetupQuery();
            setSelectedLoc(id);
            rememberLoc(id);
            await Promise.all([load(id), loadForecast(id), loadAccuracy(id)]);
          }}
          onSkip={() => setSetupSkipped(true)}
        />
      ) : (
        <>
          {!hasAnyData && <p className="note">No observations yet. You can still browse the forecast; use Settings → Collect now to start recording local conditions.</p>}
          {farSources.length > 0 && (
            <div className="panel warn-banner" style={{ marginTop: 20 }}>
              <strong>⚠ A source is far from {data.location.name}</strong> ({data.location.lat},{" "}
              {data.location.lon}).{" "}
              {farSources.map((row, i) => (
                <span key={row.source}>
                  {i > 0 ? "; " : ""}
                  <strong>{sourceLabels[row.source] || row.source}</strong> is {row.distance_mi} mi away
                  {row.place ? ` (${row.place})` : ""}
                </span>
              ))}
              . Pick a closer device for this location under <em>📍 Locations</em>, or treat the gap as a
              cross-area comparison.
            </div>
          )}

          <EventAlerts forecast={forecast} />
          <WeatherSummary data={data} forecast={forecast?.location.id === data.location.id ? forecast : null} accuracy={accuracy} loading={fcLoading} accuracyLoading={accLoading}>
          <TodayChart
            currentTemp={data.latest.purpleair?.temp_f ?? consensus(data, "temp_f")}
            ranges={dailyRanges(forecast?.location.id === data.location.id ? forecast : null, heroAccuracy(data, accuracy, accLoading))}
            forecastRanges={dailyRanges(forecast?.location.id === data.location.id ? forecast : null, heroAccuracy(data, accuracy, accLoading)).forecast}
            accuracy={accuracy?.location.id === data.location.id ? accuracy : null}
            history={data.history}
            hourly={forecast?.location.id === data.location.id ? forecast.hourly : null}
            tomorrow={forecast?.location.id === data.location.id ? forecast.hourlyTomorrow : null}
            date={forecast?.location.id === data.location.id ? forecast.date : null}
            utcOffsetSeconds={forecast?.location.id === data.location.id ? forecast.utc_offset_seconds : null}
            loading={fcLoading}
          />

          </WeatherSummary>

          {/* 3 — The detailed tables and graphs */}
          {!scenario?.overviewOnly && <>
          <h2>Compare sources — right now</h2>
          <details className="forecast-check-details">
            <summary>How today’s forecast compares with observations</summary>
            <ForecastNowCheck data={data} forecast={forecast} accuracy={accuracy} loading={fcLoading} />
          </details>
          <CurrentReadings data={data} />

          <AccuracySection accuracy={accuracy} loading={accLoading} sourceLabels={sourceLabels} />

          <h2>History — how each source tracks over time</h2>
          <HistoryCharts data={data} />

          <h2>Outlier leaderboard</h2>
          <Leaderboard data={data} />
          </>}
        </>
      )}
    </>
  );
}

// The accuracy record the hero and day cards may adjust against: scored, for this
// location, and backed by a local sensor that is reporting.
function heroAccuracy(data: Payload, accuracy: AccuracyPayload | null, accuracyLoading: boolean) {
  return !accuracyLoading && data.latest.purpleair && accuracy?.location.id === data.location.id && accuracy.hasPurpleair ? accuracy : null;
}
// Today's and tomorrow's bias-adjusted high/low, computed once for the hero's
// High/Low, the chart's day cards and the forecast curve so none of them can show a
// different number. `forecast` is the pure corrected forecast the curve is fitted to;
// `today` additionally cannot sit below a high (or above a low) already observed.
function dailyRanges(forecast: ForecastPayload | null, localAccuracy: AccuracyPayload | null) {
  const tomorrow = adjustedDailyRange(forecast?.tomorrow?.consensus ?? null, localAccuracy);
  return {
    today: adjustedDailyRange(forecast?.consensus, localAccuracy, localAccuracy ? localSoFar(localAccuracy) : null),
    tomorrow,
    forecast: { today: adjustedDailyRange(forecast?.consensus, localAccuracy), tomorrow },
  };
}

function WeatherSummary({ data, forecast, accuracy, loading, accuracyLoading, children }: { data: Payload; forecast: ForecastPayload | null; accuracy: AccuracyPayload | null; loading: boolean; accuracyLoading: boolean; children: ReactNode }) {
  const nowMs = useWeatherNow();
  const offsetMs = (forecast?.utc_offset_seconds ?? -new Date(nowMs).getTimezoneOffset() * 60) * 1000;
  const localNow = new Date(nowMs + offsetMs);
  const localTime = localNow.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  const sensor = data.latest.purpleair;
  const temp = sensor?.temp_f ?? consensus(data, "temp_f");
  const readings = sensor?.temp_f != null ? [sensor] : data.sources.map((s) => data.latest[s]).filter((r) => r?.temp_f != null);
  // The oldest contributing observation makes stale consensus data visible.
  const observedAt = readings.map((r) => r.ts).sort()[0];
  const fc = forecast?.consensus;
  const localAccuracy = heroAccuracy(data, accuracy, accuracyLoading);
  const high = leanFor(fc?.high_f ?? null, localAccuracy ? consensusBiasFor(localAccuracy, "high") : null);
  const low = leanFor(fc?.low_f ?? null, localAccuracy ? consensusBiasFor(localAccuracy, "low") : null);
  const adjusted = Boolean(high?.n || low?.n);
  // The same range the day cards show — see dailyRanges().
  const ranges = dailyRanges(forecast, localAccuracy);
  const todayRange = ranges.today;
  const expectedHigh = todayRange?.high ?? null;
  const expectedLow = todayRange?.low ?? null;
  // Current reading against the chart's forecast curve for this minute — the same
  // fitted-then-source curve TodayChart draws (fitted to the very High/Low shown
  // above), so the hero's "warmer than expected" agrees with the tooltip's "Forecast". Decided 2026-09-15: the curve is the
  // forecasters' curve, not the local projection, so this answers "how is today
  // running versus what was forecast" and shows real gaps (a slow morning reads as
  // 5° cooler, not 1°). The projection still drives the "headed warmer" verdicts.
  const today = localNow.toISOString().slice(0, 10);
  const todayHours = forecast?.hourly?.date === today ? forecast.hourly.hours : [];
  const hourlyTemps = Array.from({ length: 24 }, (_, h) => todayHours.find((r) => r.hour === h)?.temp_f ?? null);
  const expectedCurve = forecastCurve(hourlyTemps, fitCurve(hourlyTemps, ranges.forecast.today));
  // Compared at the minute the reading was TAKEN, not the current minute. A 28-minute-
  // old 69° against the 11:28 forecast (76°) read "8° cooler" while the chart's 11am
  // tooltip showed 74.7° — a 6° gap; the reading and the expectation must share a
  // clock. The curve is today's, so a reading from another day is not compared.
  const observedLocal = observedAt ? new Date(Date.parse(observedAt) + offsetMs) : null;
  const observedToday = observedLocal != null && observedLocal.toISOString().slice(0, 10) === today;
  const nowDelta = loading || !observedLocal || !observedToday ? null : nowVsExpected(temp, expectedCurve, observedLocal.getUTCHours(), observedLocal.getUTCMinutes());
  const observedClock = observedLocal ? observedLocal.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).toLowerCase().replace(" ", "") : "";
  const expectedAtReading = nowDelta && observedLocal ? expectedCurve[observedLocal.getUTCHours()] : null;
  const outlook = loading ? "Loading today’s outlook…" : fc
    ? [fc.conditions, precipLabel(fc.precip_prob, fc.precip_in)].filter(Boolean).join(" · ") || "Today’s conditions unavailable"
    : "Today’s forecast unavailable";
  return (
    <section className="panel weather-patterns" aria-label={`Weather patterns in ${data.location.name}`}>
      <div className="weather-summary" aria-label={`Current weather in ${data.location.name}`}>
        <div className="weather-current">
          <time className="weather-time" dateTime={new Date(nowMs).toISOString()}>{localTime}</time>
          <div className="weather-temperature">{temp == null ? "—" : Math.round(temp)}<span>°F</span></div>
          <div className="weather-observed">{observedAt ? `${sensor?.temp_f != null ? "Your sensor" : "Source average"} · ${relTime(observedAt, nowMs)}` : "Waiting for observations"}</div>
        </div>
        <div className="weather-outlook">
          <div className="weather-forecast-label">Today’s forecast</div>
          <div className="weather-range"><strong>High {loading || expectedHigh == null ? "—" : `${expectedHigh}°`}</strong><span>Low {loading || expectedLow == null ? "—" : `${expectedLow}°`}</span></div>
          {nowDelta && <div className={`weather-delta ${nowDelta.warmer ? "is-warmer" : "is-cooler"}`} title={`The ${observedClock} reading (${Math.round(temp!)}°) against the forecast for that minute${expectedAtReading != null ? ` (about ${Math.round(expectedAtReading)}°)` : ""}. The high and low above are the forecast for the whole day.`}>{nowDelta.delta}° {nowDelta.warmer ? "warmer" : "cooler"} than forecast at {observedClock}</div>}
        </div>
        <p className="weather-conditions">{outlook}</p>
        <CurrentConditions data={data} />
      </div>
      {children}
      <details className="tc-methodology weather-forecast-details">
        <summary>Forecast details</summary>
        {adjusted && <div className="weather-baseline">Source forecast: High {fc?.high_f ?? "—"}° / Low {fc?.low_f ?? "—"}°</div>}
        <div className="weather-calibration">{accuracyLoading ? "Checking local adjustment…" : adjusted
          ? `Adjusted using your sensor’s past forecast errors (high: ${high?.n ?? 0} days; low: ${low?.n ?? 0} days). ${Math.min(...[high?.n, low?.n].filter((n): n is number => n != null && n > 0)) < 3 ? "Early estimate." : ""}${!high?.n || !low?.n ? " Unscored values use the source forecast." : ""}`
          : "Local adjustment is learning — no scored sensor history available yet."}</div>
      </details>
    </section>
  );
}

function consensus(data: Payload, metric: string): number | null {
  const nums = data.sources
    .map((s) => (data.latest[s] ? (data.latest[s] as any)[metric] : null))
    .filter((v) => v !== null && v !== undefined) as number[];
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

// Per-source current-conditions table — detailed comparison, lives in the data section.
function CurrentReadings({ data }: { data: Payload }) {
  const nowMs = useWeatherNow();
  const { sources, latest, sourceColors, sourceLabels, metrics, metricLabels } = data;
  return (
    <div className="panel">
      <div className="table-scroll">
        <table>
        <thead>
          <tr>
            <th>Metric</th>
            {sources.map((s) => (
              <th key={s}>
                <span className="src">
                  <span className="dot" style={{ background: sourceColors[s] }} />
                  {sourceLabels[s] || s}
                </span>
              </th>
            ))}
            <th>Spread</th>
          </tr>
        </thead>
        <tbody>
          <tr className="locrow">
            <td>Location</td>
            {sources.map((s) => {
              const row = latest[s];
              const d = row?.distance_mi;
              return (
                <td key={s}>
                  <div className="loc-name">
                    {row?.source_url ? (
                      <a href={row.source_url} target="_blank" rel="noreferrer" title="Open this source to verify">
                        {locLabel(row)} <span className="ext">↗</span>
                      </a>
                    ) : (
                      locLabel(row)
                    )}
                  </div>
                  <div className={`loc-dist ${distClass(d)}`}>
                    {d == null ? <span className="na">—</span> : `${d} mi away`}
                  </div>
                </td>
              );
            })}
            <td />
          </tr>
          {metrics.map((m) => {
            const vals = sources.map((s) => (latest[s] ? (latest[s] as any)[m] : null));
            const nums = vals.filter((v) => v !== null && v !== undefined) as number[];
            const spread = nums.length >= 2
              ? Math.round((Math.max(...nums) - Math.min(...nums)) * 100) / 100
              : null;
            const t = SPREAD_THRESHOLDS[m];
            const cls = spread === null || !t ? "" : spread <= t[0] ? "lo" : spread <= t[1] ? "mid" : "hi";
            return (
              <tr key={m}>
                <td>{metricLabels[m]}</td>
                {vals.map((v, i) => (
                  <td key={i}>{v === null || v === undefined ? <span className="na">—</span> : fmt(v)}</td>
                ))}
                <td className={`spread ${cls}`}>{spread === null ? "—" : spread}</td>
              </tr>
            );
          })}
          <tr>
            <td>Conditions</td>
            {sources.map((s) => (
              <td key={s}>{latest[s]?.conditions || <span className="na">—</span>}</td>
            ))}
            <td />
          </tr>
          <tr>
            <td>Last reading</td>
            {sources.map((s) => {
              const ts = latest[s]?.ts;
              return (
                <td key={s} className="ts-cell">
                  {ts ? <span title={new Date(ts).toLocaleString()}>{relTime(ts, nowMs)}</span> : <span className="na">—</span>}
                </td>
              );
            })}
            <td />
          </tr>
        </tbody>
        </table>
      </div>
      <div className="note">
        Spread = max − min across sources for that metric right now.{" "}
        <span style={{ color: "var(--good)" }}>green</span> /{" "}
        <span style={{ color: "var(--warn)" }}>amber</span> /{" "}
        <span style={{ color: "var(--bad)" }}>red</span> flag how far the sources disagree.
      </div>
    </div>
  );
}

// The actual current reading for a metric: the local PurpleAir sensor when it reports
// one, else the nearest source that does — a real observation, not a cross-source average.
function actualObs(data: Payload, metric: string): { value: number | null; source: string | null } {
  const pa = data.latest.purpleair;
  if (pa && (pa as any)[metric] != null) return { value: (pa as any)[metric], source: "purpleair" };
  let best: { value: number; source: string; dist: number } | null = null;
  for (const s of data.sources) {
    const row = data.latest[s];
    const v = row ? (row as any)[metric] : null;
    if (v == null) continue;
    const dist = row?.distance_mi ?? Infinity;
    if (!best || dist < best.dist) best = { value: v, source: s, dist };
  }
  return best ? { value: best.value, source: best.source } : { value: null, source: null };
}

// Secondary current conditions (humidity, AQI, wind) as a compact strip — temp and
// today's high/low lead in the hero, so these sit small beneath it. Less important
// at a glance, so no per-metric source label (it's in the detailed table below).
function CurrentConditions({ data }: { data: Payload }) {
  const defs: [string, string, string][] = [
    ["humidity", "Humidity", "%"],
    ["aqi", "AQI", ""],
    ["wind_mph", "Wind", " mph"],
  ];
  return (
    <div className="mini-stats">
      {defs.map(([m, label, unit]) => {
        const { value } = actualObs(data, m);
        return (
          <div className="mini-stat" key={m}>
            <span className="mini-lbl">{label}</span>
            <span className="mini-val">{value === null ? "—" : `${value}${unit}`}</span>
          </div>
        );
      })}
    </div>
  );
}

// ----------------------------------------------- High-variance events ------

// Anything unusual about today — rain/storms, wind or air quality outside this
// location's own normal range, an abnormal high/low, or an official NWS
// advisory. The server (lib/alerts.mjs) decides what qualifies; a normal day
// renders nothing at all, so any card here is worth reading.
function EventAlerts({ forecast }: { forecast: ForecastPayload | null }) {
  const alerts = forecast?.alerts ?? [];
  if (!alerts.length) return null;
  return (
    <div className="event-alerts">
      {alerts.map((a, i) => (
        <div key={`${a.kind}-${i}`} className="event-alert" data-sev={a.severity}>
          <span className="ev-icon" aria-hidden="true">{a.icon}</span>
          <div className="ev-text">
            <div className="ev-head">{a.headline}</div>
            {a.detail && <div className="ev-detail">{a.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------- Today's heads-up ------

// How much "off by 2°" / "big spread" is worth surfacing to the user.
const ADVICE_BIAS_NOTABLE = 2; // °F: average consensus miss worth acting on
const ADVICE_SPREAD_WIDE = 4; // °F: source disagreement on today's high worth flagging

// Average signed miss of the consensus forecast (mean of the sources) vs the local
// actual — your PurpleAir sensor if present, else the cross-source mean — over the
// scored window. bias > 0 = forecast ran warm; < 0 = ran cool (actual was warmer).
// Bias-corrected expectation for one of high/low: how today's consensus should read
// given how the consensus has historically missed here. `kind` drives the wording.
function leanFor(today: number | null, bias: ReturnType<typeof consensusBiasFor>) {
  if (today == null) return null;
  if (!bias) return { kind: "none" as const, expected: today, mag: 0, mae: null as number | null, n: 0 };
  const warmerBy = -bias.bias; // + = actual tends to come in warmer than forecast
  const mag = Math.round(Math.abs(warmerBy));
  const kind = warmerBy >= ADVICE_BIAS_NOTABLE ? ("hotter" as const)
    : warmerBy <= -ADVICE_BIAS_NOTABLE ? ("colder" as const)
    : ("track" as const);
  // Only nudge the number when the lean is notable; otherwise it reads at face value.
  const expected = kind === "track" ? today : Math.round(today + warmerBy);
  return { kind, expected, mag, mae: bias.mae as number | null, n: bias.n };
}

// A plain-language "what to actually expect" card: today's consensus high AND low,
// each nudged by how the consensus has historically missed here, with a clear action.
function ForecastAdvice({ forecast, accuracy, breach }: { forecast: ForecastPayload; accuracy: AccuracyPayload | null; breach?: Breach }) {
  const [open, setOpen] = useState(false); // the explanation text collapses by default to save space
  const todayHigh = forecast.consensus.high_f;
  const todayLow = forecast.consensus.low_f;
  const highSpread = forecast.consensus.high_spread;
  const where = accuracy?.hasPurpleair ? "your sensor" : "the local average";
  const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

  const high = leanFor(todayHigh, accuracy ? consensusBiasFor(accuracy, "high") : null);
  const low = leanFor(todayLow, accuracy ? consensusBiasFor(accuracy, "low") : null);

  // The headline action follows the daytime high — the main "what to wear" signal.
  let icon = "⏳", headline = "Today's heads-up", tone = "ok", action = "";
  let foot = "";
  const lines: string[] = [];

  if (high) {
    foot = high.n ? `From ${days(high.n)} scored vs ${where}.` : "";
    const early = high.n > 0 && high.n < 3 ? " (early read — only a few days in)" : "";
    if (high.kind === "hotter") {
      icon = warmIcon(high.expected); tone = "warm"; headline = "Runs warmer than forecast";
      action = `Consider it ~${high.mag}° hotter than forecast`;
      lines.push(`Figure closer to ${high.expected}° than the ${todayHigh}° forecast high — it has come in about ${high.mag}° warmer over the last ${days(high.n)}${early}.`);
    } else if (high.kind === "colder") {
      icon = "❄️"; tone = "cool"; headline = "Runs cooler than forecast";
      action = `Consider it ~${high.mag}° colder than forecast`;
      lines.push(`Figure closer to ${high.expected}° than the ${todayHigh}° forecast high — it has come in about ${high.mag}° cooler over the last ${days(high.n)}${early}.`);
    } else if (high.kind === "track") {
      icon = "✅"; tone = "ok"; headline = "Forecast tracks well";
      action = "Take it at face value";
      lines.push(`Forecast highs have landed within about ${high.mae}° of actual${early}, so ${todayHigh}° is a safe bet.`);
    } else {
      icon = "⏳"; tone = "ok"; headline = "Learning your local read";
      action = "Take it at face value for now";
      lines.push(`No completed days are scored yet — once one is, this will tell you whether to expect warmer or cooler than forecast at ${where}.`);
    }
  } else {
    lines.push("Today's read appears here once the forecast loads.");
  }

  // Always speak to the overnight low, too.
  if (low && todayLow != null) {
    if (low.kind === "hotter" || low.kind === "colder") {
      const w = low.kind === "hotter" ? "warmer" : "cooler";
      lines.push(`Overnight lows have run about ${low.mag}° ${w} than forecast — figure closer to ${low.expected}° than ${todayLow}°.`);
    } else if (low.kind === "track") {
      lines.push(`Overnight lows have landed within about ${low.mae}° of actual, so ${todayLow}° looks right.`);
    }
  }

  // Source disagreement on the high, framed to fit the action rather than fight it:
  // when the consensus has tracked well it's still the call (it splits the gap); when
  // it's biased, the spread just widens the band around the corrected number.
  if (high && highSpread != null && highSpread >= ADVICE_SPREAD_WIDE) {
    const highs = forecast.sources
      .map((s) => (forecast.forecasts[s]?.status === "ok" ? forecast.forecasts[s].high_f : null))
      .filter((v): v is number => v != null);
    const range = highs.length ? ` (${Math.min(...highs)}–${Math.max(...highs)}°)` : "";
    if (high.kind === "hotter" || high.kind === "colder") {
      lines.push(`The two sources are ${highSpread}° apart today${range}, so treat ~${high.expected}° as the middle of a wide range.`);
    } else {
      lines.push(`The two sources are ${highSpread}° apart today${range}; the ${todayHigh}° consensus splits the difference.`);
    }
  }

  // If today's actuals have already passed the forecast, that supersedes the historical
  // read — say so plainly instead of "take it at face value."
  if (breach && (breach.highBlown || breach.lowBlown)) {
    tone = "warm"; headline = "Forecast already off today";
    if (breach.highBlown && todayHigh != null) {
      icon = warmIcon(breach.highSoFar); action = "Already warmer than forecast";
      lines[0] = `Today's high has already passed the ${breach.bounds?.high ?? todayHigh}° forecast (${breach.highSoFar}° so far) — the live read up top has the current picture.`;
    } else if (breach.lowBlown && todayLow != null) {
      icon = "❄️"; tone = "cool"; action = "Already colder than forecast";
      lines[0] = `Today's low has already dropped below the ${breach.bounds?.low ?? todayLow}° forecast (${breach.lowSoFar}° so far) — the live read up top has the current picture.`;
    }
  }

  const showTemps = action !== "" && (todayHigh != null || todayLow != null);
  const collapsible = lines.length > 0 || !!foot; // there's explanation text to reveal
  const toggle = () => setOpen((o) => !o);
  return (
    <aside
      className="advice"
      data-tone={tone}
      data-clickable={collapsible || undefined}
      role={collapsible ? "button" : undefined}
      tabIndex={collapsible ? 0 : undefined}
      aria-expanded={collapsible ? open : undefined}
      onClick={collapsible ? toggle : undefined}
      onKeyDown={collapsible ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } } : undefined}
    >
      <div className="advice-head">
        <span className="advice-icon">{icon}</span>
        <span className="advice-headline">{headline}</span>
        {collapsible && <span className="advice-caret" aria-hidden="true">{open ? "▴" : "▾"}</span>}
      </div>
      {action && <div className="advice-action">{action}</div>}
      {showTemps && (
        <div className="advice-temps">
          {todayHigh != null && <span><b>~{breach?.highBlown && breach.highSoFar != null ? breach.highSoFar : (high ? high.expected : todayHigh)}°</b> high</span>}
          {todayLow != null && <span><b>~{breach?.lowBlown && breach.lowSoFar != null ? breach.lowSoFar : (low ? low.expected : todayLow)}°</b> low</span>}
        </div>
      )}
      {collapsible && open && (
        <div className="advice-body">
          {lines.map((l, i) => <p key={i}>{l}</p>)}
          {foot && <div className="advice-foot">{foot}</div>}
        </div>
      )}
    </aside>
  );
}

// ---------------------------------------------- Forecast reality check ------

function fmtHour(h: number) {
  const pm = h >= 12;
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${pm ? "pm" : "am"}`;
}

// Wall-clock label for when a reading was collected, e.g. "12:15pm" — with the
// day tacked on ("Aug 28, 4:31pm") when it isn't from today, so a stale reading
// can't pass itself off as this afternoon's.
function fmtClock(ts: string) {
  const d = new Date(ts);
  const h = d.getHours();
  const hh = h % 12 === 0 ? 12 : h % 12;
  const clock = `${hh}:${String(d.getMinutes()).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
  if (d.toDateString() === new Date().toDateString()) return clock;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${clock}`;
}

// Today's running high/low at the local sensor (PurpleAir when it has data
// today, else the broadest envelope across sources' observed-so-far), from the
// accuracy provisional.
function localSoFar(accuracy: AccuracyPayload | null): { high: number | null; low: number | null; frame: ObsFrame } {
  if (!accuracy) return { high: null, low: null, frame: "sources" };
  if (accuracy.hasPurpleair) {
    const p = accuracy.provisional.find((x) => x.purpleairSoFar);
    if (p) return { high: p.purpleairSoFar?.high_f ?? null, low: p.purpleairSoFar?.low_f ?? null, frame: "sensor" };
    // hasPurpleair can be true from old history while the sensor is gone or
    // quiet today — fall through to the envelope rather than report nothing.
  }
  const highs = accuracy.provisional.map((x) => x.observedSoFar?.high_f).filter((v): v is number => v != null);
  const lows = accuracy.provisional.map((x) => x.observedSoFar?.low_f).filter((v): v is number => v != null);
  return { high: highs.length ? Math.max(...highs) : null, low: lows.length ? Math.min(...lows) : null, frame: "sources" };
}

type Bounds = { high: number | null; low: number | null; corrected: boolean };
type Breach = { highBlown: boolean; lowBlown: boolean; highSoFar: number | null; lowSoFar: number | null; bounds: Bounds | null };

// Today's running high/low and the forecast bounds, reduced to ONE frame so the two are
// comparable. `localSoFar` decides it: whichever thermometers actually reported today.
//
// The current reading joins them only if it came off those same thermometers. It is not
// always today's — `data.latest` is the newest reading per source at any age — so a
// sensor that last reported yesterday afternoon sits beside a source-frame envelope.
// Folding that in would put a sensor-scale number into a source-scale high/low and then
// compare it against sensor-corrected bounds, which reads as a breach every time.
function todayVsForecast(data: Payload, forecast: ForecastPayload, accuracy: AccuracyPayload | null) {
  const paNow = data.latest.purpleair?.temp_f ?? null;
  const nowTemp = paNow ?? consensus(data, "temp_f");
  const sf = localSoFar(accuracy);
  const nowFrame: ObsFrame = paNow != null ? "sensor" : "sources";
  const frame = sf.high != null || sf.low != null ? sf.frame : nowFrame;
  const inFrame = nowFrame === frame ? nowTemp : null;
  const highs = [sf.high, inFrame].filter((v): v is number => v != null);
  const lows = [sf.low, inFrame].filter((v): v is number => v != null);
  return {
    nowTemp,
    bounds: comparableBounds(forecast.consensus.high_f, forecast.consensus.low_f, accuracy, frame),
    highSoFar: highs.length ? Math.max(...highs) : null,
    lowSoFar: lows.length ? Math.min(...lows) : null,
  };
}

// Has today's reality already passed a forecast bound? Same rule as the live check —
// the running high can only rise and the low can only fall, so a pass is certain.
function forecastBreach(data: Payload, forecast: ForecastPayload, accuracy: AccuracyPayload | null): Breach {
  const { nowTemp, bounds, highSoFar, lowSoFar } = todayVsForecast(data, forecast, accuracy);
  if (nowTemp == null) return { highBlown: false, lowBlown: false, highSoFar: null, lowSoFar: null, bounds: null };
  return { ...breachAt(bounds, highSoFar, lowSoFar), highSoFar, lowSoFar, bounds };
}

// "Is the forecast already wrong, right now?" — compares today's running high/low (your
// sensor) against the forecast bounds. You can only be CERTAIN the forecast is wrong once
// reality has already passed a bound, so that's the only thing it asserts outright;
// otherwise it's "on track so far." Also shows the current temperature and the projection.
function ForecastNowCheck({ data, forecast, accuracy, loading }: { data: Payload; forecast: ForecastPayload | null; accuracy: AccuracyPayload | null; loading?: boolean }) {
  const [open, setOpen] = useState(false); // verdict detail collapses by default to save space
  const paNow = data.latest.purpleair?.temp_f ?? null;
  const nowTemp = paNow ?? consensus(data, "temp_f");
  const sensor = paNow != null ? (data.sourceLabels.purpleair || "Your sensor") : "The sources";

  // When the shown temperature was actually collected — a reading from an hour
  // ago shouldn't dress itself up as "now". PA when it leads; else the freshest
  // of the sources feeding the consensus.
  const readTs = paNow != null
    ? data.latest.purpleair?.ts ?? null
    : data.sources.reduce<string | null>((best, s) => {
        const row = data.latest[s];
        return row?.temp_f != null && (!best || row.ts > best) ? row.ts : best;
      }, null);
  const readAt = readTs ? `as of ${fmtClock(readTs)}` : "now";

  if (nowTemp == null) {
    return (
      <div className="nowcheck" data-tone="ok">
        <div className="nowcheck-body"><div className="nowcheck-verdict"><span className="nowcheck-icon">⏳</span> Waiting for today's first reading</div></div>
      </div>
    );
  }

  // Lead element: show the current reading even before the forecast comparison loads.
  if (!forecast) {
    return (
      <div className="nowcheck" data-tone="ok">
        <div className="nowcheck-now">
          <div className="nowcheck-temp">{Math.round(nowTemp)}°</div>
          <div className="nowcheck-lbl" title={readTs ? new Date(readTs).toLocaleString() : undefined}>
            {readAt} · {sensor}
          </div>
        </div>
        <div className="nowcheck-body">
          <div className="nowcheck-verdict"><span className="nowcheck-icon">⏳</span> {loading ? "Checking today's forecast…" : "Forecast unavailable right now"}</div>
        </div>
      </div>
    );
  }

  const cond = forecast.consensus.conditions ?? null;
  const condRain = precipLabel(forecast.consensus.precip_prob, forecast.consensus.precip_in);

  // Today's readings and the forecast bounds in one frame — see `todayVsForecast`.
  // `fcHigh`/`fcLow` are the corrected bounds; `corrected` says whether they moved,
  // which is what the asterisk marks.
  const { bounds, highSoFar, lowSoFar } = todayVsForecast(data, forecast, accuracy);
  const { high: fcHigh, low: fcLow, corrected } = bounds;
  const star = corrected ? "*" : "";
  const { highBlown, lowBlown } = breachAt(bounds, highSoFar, lowSoFar);

  // Diurnal extrapolation: where we sit on the typical daily curve + the projected high.
  const dn = accuracy?.diurnal ?? null;
  const peakAt = dn?.peakHour != null ? fmtHour(dn.peakHour) : null;
  const pastPeak = dn?.peakHour != null && dn?.nowHour != null && dn.nowHour >= dn.peakHour;
  const est = dn?.estHigh ?? null;
  const pct = dn?.pctToPeak ?? null;
  const projBeat = !highBlown && est != null && fcHigh != null && est > fcHigh + NOWCHECK_TOL && !pastPeak;
  // One sentence about how much more the high has left in it, from the curve.
  const highOutlook = (): string | null => {
    if (peakAt == null) return null;
    if (pastPeak) return `Today's peak (~${peakAt}) has passed, so the high is likely in.`;
    if (est == null) return `Temps here usually peak around ${peakAt}.`;
    return pct != null && pct < 90
      ? `It's about ${pct}% of the way to today's peak (~${peakAt}), tracking toward ~${est}°.`
      : `It's near today's peak (~${peakAt}), so ~${est}° is about as high as it gets.`;
  };

  let icon = "✅", headline = "On track with the forecast", tone = "ok";
  const lines: string[] = [];

  if (highBlown && lowBlown) {
    icon = "⚠️"; tone = "warm"; headline = "Outside the forecast range";
    lines.push(`It has already swung ${lowSoFar}–${highSoFar}° today — outside the forecast's ${fcLow}–${fcHigh}°${star} range. Don't trust today's numbers.`);
  } else if (highBlown) {
    const by = Math.round((highSoFar as number) - (fcHigh as number));
    icon = warmIcon(highSoFar as number); tone = "warm"; headline = "Warmer than expected";
    lines.push(`${sensor} has already hit ${highSoFar}° — ${by}° past the ${fcHigh}°${star} forecast high.`);
    const o = highOutlook(); if (o) lines.push(o);
  } else if (projBeat) {
    icon = warmIcon(est); tone = "warm"; headline = "Headed warmer than expected";
    lines.push(`${Math.round(nowTemp)}° now${pct != null ? `, about ${pct}% of the way to today's peak (~${peakAt})` : ""} — on pace to reach ~${est}°, past the ${fcHigh}°${star} forecast high.`);
  } else if (lowBlown) {
    const by = Math.round((fcLow as number) - (lowSoFar as number));
    icon = "❄️"; tone = "cool"; headline = "Colder than expected";
    lines.push(`${sensor} dropped to ${lowSoFar}° — ${by}° below the ${fcLow}°${star} forecast low. The morning ran colder than forecast.`);
  } else {
    const range = fcLow != null && fcHigh != null ? `${fcLow}–${fcHigh}°${star}` : "today's forecast";
    if (est != null && !pastPeak) {
      lines.push(`${Math.round(nowTemp)}° now, tracking toward ~${est}°${peakAt ? ` around ${peakAt}` : ""} — inside the ${range} forecast.`);
    } else {
      // The running range is only quotable when today actually reported one in this frame.
      const swing = lowSoFar != null && highSoFar != null ? ` The day's range so far (${lowSoFar}–${highSoFar}°) hasn't broken it.` : "";
      lines.push(`${Math.round(nowTemp)}° now, inside the ${range} forecast.${swing}`);
    }
  }

  const collapsible = lines.length > 0; // there's verdict detail to reveal
  const toggle = () => setOpen((o) => !o);
  return (
    <div
      className="nowcheck"
      data-tone={tone}
      data-clickable={collapsible || undefined}
      role={collapsible ? "button" : undefined}
      tabIndex={collapsible ? 0 : undefined}
      aria-expanded={collapsible ? open : undefined}
      onClick={collapsible ? toggle : undefined}
      onKeyDown={collapsible ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } } : undefined}
    >
      <div className="nowcheck-head">
        <div className="nowcheck-now">
          <div className="nowcheck-temp">{Math.round(nowTemp)}°</div>
          <div className="nowcheck-lbl" title={readTs ? new Date(readTs).toLocaleString() : undefined}>
            {readAt} · {sensor}
          </div>
        </div>
        {/* Today's numbers: the forecast bounds beside what's actually been
            observed so far today (the running high can only rise, the low only
            fall — so these firm up through the day). */}
        <div className="nowcheck-hl">
          <span className="hl-cap" />
          <span className="hl-col">Forecast{star}</span>
          <span className="hl-col">So far</span>

          <span className="hl-cap">Hi</span>
          <span className="hl-val hi">
            {fcHigh != null ? `${fcHigh}°` : "—"}
            {dn?.peakHour != null && <span className="hl-when"> ~{fmtHour(dn.peakHour)}</span>}
          </span>
          <span className="hl-val hi">{highSoFar != null ? `${Math.round(highSoFar)}°` : "—"}</span>

          <span className="hl-cap">Lo</span>
          <span className="hl-val lo">
            {fcLow != null ? `${fcLow}°` : "—"}
            {dn?.troughHour != null && <span className="hl-when"> ~{fmtHour(dn.troughHour)}</span>}
          </span>
          <span className="hl-val lo">{lowSoFar != null ? `${Math.round(lowSoFar)}°` : "—"}</span>
        </div>
      </div>
      <div className="nowcheck-body">
        <div className="nowcheck-verdict">
          <span className="nowcheck-icon">{icon}</span>
          <span className="nowcheck-headline">{headline}</span>
          {collapsible && <span className="nowcheck-caret" aria-hidden="true">{open ? "▴" : "▾"}</span>}
        </div>
        {/* What the day looks like — always visible, even when rain is too
            unlikely to earn an alert card ("what do I wear?" needs the 20% days too). */}
        {(cond || condRain) && (
          <div className="nowcheck-conditions">
            {condIcon(cond, forecast.consensus.precip_prob)} {cond}{cond && condRain ? " · " : ""}{condRain}
          </div>
        )}
        {open && lines.map((l, i) => <p key={i} className="nowcheck-detail">{l}</p>)}
        {/* Without this, a sensor that reads warm looks like a blown forecast every
            afternoon — so say plainly that the bounds moved, and by how much. */}
        {open && corrected && (
          <p className="nowcheck-detail nowcheck-note">
            * Forecast bounds shifted to {sensor.toLowerCase()}’s scale before comparing, using the
            same historical miss the outlook below applies. The sources published{" "}
            {forecast.consensus.high_f ?? "—"}°/{forecast.consensus.low_f ?? "—"}°.
          </p>
        )}
      </div>
    </div>
  );
}

// The "what to actually expect" heads-up. Today's high/low now lead in the hero
// (ForecastNowCheck), so this is just the historical-lean interpretation that
// complements them — no duplicated consensus cards.
function ForecastSection({ forecast, loading, accuracy, data }: { forecast: ForecastPayload | null; loading: boolean; accuracy: AccuracyPayload | null; data: Payload }) {
  if (loading && !forecast) return <div className="panel empty" style={{ marginTop: 12 }}>Loading forecast…</div>;
  if (!forecast) return <div className="panel empty" style={{ marginTop: 12 }}>Forecast unavailable right now.</div>;
  const breach = forecastBreach(data, forecast, accuracy);
  return <ForecastAdvice forecast={forecast} accuracy={accuracy} breach={breach} />;
}

// --------------------------------------------------------- tomorrow ------

// Within this °F of today's forecast high, tomorrow reads "about like today".
const TMRW_SAME_TOL = 2;

// One-glance answer to "what's tomorrow like?": consensus high/low, expected
// sky and rain, and the trend vs TODAY'S forecast (forecast vs forecast, so the
// day-over-day delta cancels the forecaster's systematic bias — same reasoning
// as the yesterday card). Because this app scores forecasts against local
// reality, a notable local lean adds the bias-corrected number no generic
// weather app can give.
function TomorrowCard({ forecast, accuracy }: { forecast: ForecastPayload | null; accuracy: AccuracyPayload | null }) {
  const t = forecast?.tomorrow;
  if (!t || (t.consensus.high_f == null && t.consensus.low_f == null)) return null;
  const high = t.consensus.high_f;
  const low = t.consensus.low_f;
  const cond = t.consensus.conditions ?? null;
  const rain = precipLabel(t.consensus.precip_prob, t.consensus.precip_in);

  const dHigh = high != null && forecast?.consensus.high_f != null ? high - forecast.consensus.high_f : null;
  let tone = "ok";
  let trend: string | null = null;
  if (dHigh != null) {
    if (Math.abs(dHigh) < TMRW_SAME_TOL) trend = "about like today";
    else if (dHigh > 0) { tone = "warm"; trend = `${dHigh}° warmer than today`; }
    else { tone = "cool"; trend = `${-dHigh}° cooler than today`; }
  }

  const lean = leanFor(high, accuracy ? consensusBiasFor(accuracy, "high") : null);
  const weekday = t.date ? new Date(`${t.date}T12:00:00`).toLocaleDateString([], { weekday: "long" }) : null;

  return (
    <div className="yday tmrw" data-tone={tone}>
      <div className="yday-head">
        <span className="yday-icon">{condIcon(cond, t.consensus.precip_prob)}</span>
        Tomorrow{weekday ? ` — ${weekday}` : ""}{trend ? ` · ${trend}` : ""}
      </div>
      <div className="tmrw-row">
        <span className="tmrw-temps">
          {high != null && <span><b>{high}°</b> high</span>}
          {low != null && <span><b>{low}°</b> low</span>}
        </span>
        {(cond || rain) && (
          <span className="tmrw-cond">{cond}{cond && rain ? " · " : ""}{rain}</span>
        )}
      </div>
      {lean && (lean.kind === "hotter" || lean.kind === "colder") && (
        <div className="tmrw-note">
          Locally figure closer to ~{lean.expected}° — forecasts here have run about {lean.mag}°{" "}
          {lean.kind === "hotter" ? "cool" : "warm"} lately.
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------ vs yesterday ------

// Within this many °F, today reads "about the same" as yesterday rather than a
// warmer/cooler call.
const YDAY_SAME_TOL = 2;

// "Warmer or cooler than yesterday?" — two complementary comparisons:
//   • Right now vs yesterday at this same local time (actual vs actual — the live feel).
//   • Today's consensus forecast high/low vs yesterday's consensus forecast (both
//     predictions, so the trend cancels the forecaster's systematic bias).
// Hidden until at least one comparison is available.
function YesterdayCompare({ forecast, accuracy, data }: { forecast: ForecastPayload | null; accuracy: AccuracyPayload | null; data: Payload }) {
  const y = accuracy?.yesterday;
  const yAt = accuracy?.yesterdayAtTime;

  // Forecast vs forecast (today's consensus vs yesterday's consensus).
  const tHigh = forecast?.consensus.high_f ?? null;
  const tLow = forecast?.consensus.low_f ?? null;
  const dHigh = y && tHigh != null && y.high_f != null ? tHigh - y.high_f : null;
  const dLow = y && tLow != null && y.low_f != null ? tLow - y.low_f : null;

  // Now vs yesterday at this time (actual vs actual). "Now" prefers the local sensor,
  // matching how yesterdayAtTime is sourced.
  const nowTemp = data.latest.purpleair?.temp_f ?? consensus(data, "temp_f");
  const dNow = yAt && yAt.temp != null && nowTemp != null ? Math.round(nowTemp) - yAt.temp : null;

  if (dHigh == null && dLow == null && dNow == null) return null;

  const atTime = yAt ? fmtHour(Math.round(yAt.hour)) : null; // ≈ the current local time

  // One grid row per comparison: today's value, yesterday's value, and the delta.
  const rows = [
    dNow != null && yAt ? { key: "now", label: `Right now (${atTime})`, today: Math.round(nowTemp as number), yest: yAt.temp as number, d: dNow } : null,
    dHigh != null ? { key: "hi", label: "Forecast high", today: tHigh as number, yest: y!.high_f as number, d: dHigh } : null,
    dLow != null ? { key: "lo", label: "Forecast low", today: tLow as number, yest: y!.low_f as number, d: dLow } : null,
  ].filter(Boolean) as { key: string; label: string; today: number; yest: number; d: number }[];

  // Δ cell: arrow + magnitude, color-coded; "≈" within the "about the same" band.
  const deltaCell = (d: number) => {
    const m = Math.abs(Math.round(d));
    if (m < YDAY_SAME_TOL) return { cls: "same", text: "≈" };
    return { cls: d > 0 ? "warm" : "cool", text: `${d > 0 ? "↑" : "↓"}${m}°` };
  };

  // The live now-vs-yesterday delta drives the headline when available (most immediate);
  // otherwise the daytime-high forecast trend, then the low.
  const primary = dNow ?? dHigh ?? (dLow as number);
  let icon = "🌡️", headline = "About the same as yesterday", tone = "ok";
  if (Math.abs(Math.round(primary)) >= YDAY_SAME_TOL) {
    if (primary > 0) { icon = warmIcon(tHigh ?? (nowTemp != null ? Math.round(nowTemp) : null)); headline = "Warmer than yesterday"; tone = "warm"; }
    else { icon = "❄️"; headline = "Cooler than yesterday"; tone = "cool"; }
  }

  const ydate = y?.date ?? yAt?.date;

  return (
    <div className="yday" data-tone={tone}>
      <div className="yday-head"><span className="yday-icon">{icon}</span> {headline}</div>
      <div className="yday-grid">
        <div className="yg-h" />
        <div className="yg-h">Today</div>
        <div className="yg-h">Yest.</div>
        <div className="yg-h">Δ</div>
        {rows.map((r) => {
          const dc = deltaCell(r.d);
          return (
            <Fragment key={r.key}>
              <div className="yg-label">{r.label}</div>
              <div className="yg-today">{r.today}°</div>
              <div className="yg-yest">{r.yest}°</div>
              <div className={`yg-delta ${dc.cls}`}>{dc.text}</div>
            </Fragment>
          );
        })}
      </div>
      <div className="yday-foot">vs yesterday{ydate ? ` · ${ydate}` : ""}</div>
    </div>
  );
}

// -------------------------------------------------- Forecast accuracy ------

function fmtStat(st: AccStat) {
  if (!st) return <span className="na">—</span>;
  const b = `${st.bias >= 0 ? "+" : ""}${st.bias}`;
  return (
    <span>
      <strong>{st.mae}°</strong> <span className="muted">({b})</span>
    </span>
  );
}

function fmtSigned(v: number | null) {
  if (v == null) return <span className="na">—</span>;
  return <span>{v >= 0 ? "+" : ""}{v}°</span>;
}

function hiLo(o: HiLo) {
  if (!o || (o.high_f == null && o.low_f == null)) return <span className="na">—</span>;
  return <span>{o.high_f ?? "—"}° / {o.low_f ?? "—"}°</span>;
}

function ProvisionalToday({
  accuracy,
  sourceLabels,
}: {
  accuracy: AccuracyPayload;
  sourceLabels: Record<string, string>;
}) {
  const rows = accuracy.provisional.filter((p) => p.forecast);
  if (!rows.length) return null;
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="fg-title" style={{ marginBottom: 6 }}>
        Today so far · {accuracy.todayLocal} <span className="muted" style={{ fontWeight: 400 }}>(in progress — not a final score)</span>
      </div>
      <div className="table-scroll">
        <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>Forecast (H / L)</th>
            <th>Observed so far (H / L)</th>
            {accuracy.hasPurpleair && <th>PurpleAir so far (H / L)</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.source}>
              <td>{sourceLabels[p.source] || p.source}</td>
              <td>{hiLo(p.forecast)}</td>
              <td>{hiLo(p.observedSoFar)}</td>
              {accuracy.hasPurpleair && <td>{hiLo(p.purpleairSoFar)}</td>}
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      <div className="note">
        The day's high usually lands in the afternoon, so “observed so far” climbs through the day — this only becomes
        a real accuracy score once the day is over (then it joins the table below).
      </div>
    </div>
  );
}

function AccuracySection({
  accuracy,
  loading,
  sourceLabels,
}: {
  accuracy: AccuracyPayload | null;
  loading: boolean;
  sourceLabels: Record<string, string>;
}) {
  if (loading && !accuracy) {
    return (
      <>
        <h2>Forecast accuracy — 1-day-ahead</h2>
        <div className="panel empty">Scoring forecasts…</div>
      </>
    );
  }
  if (!accuracy) {
    return (
      <>
        <h2>Forecast accuracy — 1-day-ahead</h2>
        <div className="panel empty">Accuracy unavailable right now.</div>
      </>
    );
  }

  if (accuracy.scoredDays === 0) {
    return (
      <>
        <h2>Forecast accuracy — 1-day-ahead</h2>
        <ProvisionalToday accuracy={accuracy} sourceLabels={sourceLabels} />
        <div className="panel">
          <strong>No completed days scored yet.</strong>{" "}
          {accuracy.forecastsLogged > 0 ? (
            <>
              {accuracy.forecastsLogged} one-day-ahead forecast{accuracy.forecastsLogged === 1 ? "" : "s"} logged. A
              real score needs a day that's <em>over</em> and whose forecast was logged the day before — so today's
              forecast scores tomorrow. Keep the collector running and watch “today so far” above in the meantime.
            </>
          ) : (
            <>No forecasts logged yet for this location. Click <em>↻ Collect now</em> (or run the collector) to start
              logging tomorrow's forecast.</>
          )}
        </div>
      </>
    );
  }

  const sources = accuracy.perSource;
  const rows: { label: string; cell: (p: AccSource) => React.ReactNode }[] = [
    { label: "Days scored", cell: (p) => p.days },
    { label: "High — vs own obs", cell: (p) => fmtStat(p.vsOwn.high) },
    { label: "Low — vs own obs", cell: (p) => fmtStat(p.vsOwn.low) },
    { label: "High — vs PurpleAir", cell: (p) => fmtStat(p.vsPurpleair.high) },
    { label: "Low — vs PurpleAir", cell: (p) => fmtStat(p.vsPurpleair.low) },
    { label: "High — station gap", cell: (p) => fmtSigned(p.obsGap?.high ?? null) },
    { label: "Low — station gap", cell: (p) => fmtSigned(p.obsGap?.low ?? null) },
  ];

  return (
    <>
      <h2>Forecast accuracy — 1-day-ahead (last {accuracy.windowDays} days)</h2>
      <ProvisionalToday accuracy={accuracy} sourceLabels={sourceLabels} />
      <div className="panel">
        <div className="table-scroll">
          <table>
          <thead>
            <tr>
              <th>Metric</th>
              {sources.map((p) => (
                <th key={p.source}>{sourceLabels[p.source] || p.source}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                {sources.map((p) => (
                  <td key={p.source}>{r.cell(p)}</td>
                ))}
              </tr>
            ))}
          </tbody>
          </table>
        </div>
        <div className="note">
          <strong>MAE</strong> = average miss; <strong>bias</strong> = average signed error (+ ran warm).{" "}
          <strong>vs own obs</strong> scores each source's forecast against its own observed high/low (NWS from logged
          readings, Open-Meteo from its archive). <strong>vs PurpleAir</strong> scores against your local sensor.{" "}
          <strong>Station gap</strong> = own observation − PurpleAir (how far the source's station sits from your spot) —
          a big gap explains forecast error that's really a siting difference, not a bad model.
          {!accuracy.hasPurpleair && " Add a PurpleAir sensor to this location to fill in the PurpleAir columns."}
        </div>
      </div>

      {accuracy.daily.length >= 1 && (
        <AccuracyCharts
          daily={accuracy.daily}
          sources={sources.map((p) => p.source)}
          sourceLabels={sourceLabels}
          sourceColors={SOURCE_COLORS_FALLBACK}
          hasPurpleair={accuracy.hasPurpleair}
        />
      )}
    </>
  );
}

// Source colors for accuracy charts (the accuracy payload doesn't carry them).
const SOURCE_COLORS_FALLBACK: Record<string, string> = {
  nws: "#4fa3ff",
  open_meteo: "#34d399",
  purpleair: "#a78bfa",
};

// ----------------------------------------------------------- Locations ------

type Station = {
  source: string;
  status: string;
  error: string | null;
  place: string | null;
  lat: number | null;
  lon: number | null;
  source_url: string | null;
  distance_mi: number | null;
};

type LocFields = {
  name: string;
  lat: string;
  lon: string;
  purpleair_sensor_index: string;
};

function LocationForm({
  initial,
  submitLabel,
  onSubmit,
  keys,
  sourceLabels,
  busy,
  onCancel,
  onKeySaved,
}: {
  initial?: Partial<LocationCfg>;
  submitLabel: string;
  onSubmit: (f: LocFields) => void;
  keys: Payload["keys"];
  sourceLabels: Record<string, string>;
  busy: boolean;
  onCancel?: () => void;
  onKeySaved?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [lat, setLat] = useState(initial?.lat != null ? String(initial.lat) : "");
  const [lon, setLon] = useState(initial?.lon != null ? String(initial.lon) : "");
  const [pa, setPa] = useState(initial?.purpleair_sensor_index ?? "");
  const [paTouched, setPaTouched] = useState(!!initial?.purpleair_sensor_index);
  const [stations, setStations] = useState<Station[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkErr, setCheckErr] = useState<string | null>(null);
  const [showIndex, setShowIndex] = useState(false);

  const canSubmit = lat.trim() !== "" && lon.trim() !== "";
  const { sensors, loading: findingPa, error: paErr, reload: reloadSensors } = useNearbySensors(
    lat,
    lon,
    keys.purpleair && canSubmit,
  );

  useEffect(() => {
    if (!paTouched && sensors[0]) setPa(sensors[0].sensor_index);
  }, [sensors, paTouched]);

  const pick = (rsl: GeoResult) => {
    setName(rsl.name);
    setLat(String(rsl.lat));
    setLon(String(rsl.lon));
    setStations(null);
    setPa("");
    setPaTouched(false);
  };

  const checkDistances = async () => {
    setChecking(true);
    setCheckErr(null);
    try {
      const params = new URLSearchParams({ lat: lat.trim(), lon: lon.trim() });
      if (pa.trim()) params.set("purpleair_sensor_index", pa.trim());
      const res = await fetch(`${API}/stations?${params.toString()}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `failed (${res.status})`);
      setStations(j.stations || []);
    } catch (e: any) {
      setCheckErr(e.message);
      setStations(null);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="loc-form">
      <PlaceSearch onPicked={pick} disabled={busy} />

      <div className="loc-grid">
        <div>
          <label>Name</label>
          <input type="text" value={name} placeholder="Display name" onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label>Latitude</label>
          <input type="text" inputMode="decimal" value={lat} placeholder="37.7749" onChange={(e) => { setLat(e.target.value); setStations(null); setPa(""); setPaTouched(false); }} />
        </div>
        <div>
          <label>Longitude</label>
          <input type="text" inputMode="decimal" value={lon} placeholder="-122.4194" onChange={(e) => { setLon(e.target.value); setStations(null); setPa(""); setPaTouched(false); }} />
        </div>
      </div>

      <div>
        <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
          PurpleAir sensor {keys.purpleair ? "(optional)" : ""}
        </label>
        {!keys.purpleair ? (
          <PurpleAirKeyField onSaved={() => onKeySaved?.()} disabled={busy} />
        ) : !canSubmit ? (
          <div className="note" style={{ marginTop: 0 }}>Set coordinates to list nearby outdoor sensors.</div>
        ) : (
          <>
            <NearbySensorPicker
              sensors={sensors}
              loading={findingPa}
              error={paErr}
              selected={pa}
              onSelect={(id) => { setPa(id); setPaTouched(true); }}
              onRetry={reloadSensors}
            />
            <button type="button" className="linkbtn" style={{ marginTop: 8 }} onClick={() => setShowIndex((s) => !s)}>
              {showIndex ? "hide sensor index" : "enter a sensor index"}
            </button>
            {showIndex && (
              <div className="loc-grid" style={{ marginTop: 6 }}>
                <div>
                  <label>Sensor index</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={pa}
                    placeholder="e.g. 62489"
                    onChange={(e) => { setPa(e.target.value); setPaTouched(true); }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="loc-form-actions">
        <button
          className="btn"
          disabled={busy || !canSubmit}
          onClick={() => onSubmit({ name, lat, lon, purpleair_sensor_index: pa })}
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        <button className="btn secondary" disabled={!canSubmit || checking} onClick={checkDistances}>
          {checking ? "Checking…" : "📏 Check station distances"}
        </button>
        {onCancel && (
          <button className="btn secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        )}
      </div>

      {checkErr && <div className="err-msg" style={{ marginTop: 8 }}>{checkErr}</div>}
      {stations && (
        <div className="station-dists">
          <div className="note" style={{ marginTop: 0, marginBottom: 8 }}>
            Distance from this point to each source's actual station (live check, not saved):
          </div>
          {stations.map((st) => (
            <div className="station-row" key={st.source}>
              <span className="station-src">{sourceLabels[st.source] || st.source}</span>
              {st.status === "ok" ? (
                <>
                  <span className={`station-dist ${distClass(st.distance_mi)}`}>
                    {st.distance_mi == null ? "—" : `${st.distance_mi} mi`}
                  </span>
                  <span className="muted">
                    {st.source_url ? (
                      <a href={st.source_url} target="_blank" rel="noreferrer">
                        {st.place || (st.lat != null ? `${st.lat}, ${st.lon}` : "source")} <span className="ext">↗</span>
                      </a>
                    ) : (
                      st.place || (st.lat != null ? `${st.lat}, ${st.lon}` : "—")
                    )}
                  </span>
                </>
              ) : (
                <span className="muted">unavailable{st.error ? ` — ${st.error.slice(0, 60)}` : ""}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <span className="note" style={{ marginTop: 4, display: "block" }}>
        NWS &amp; Open-Meteo auto-pick the closest station to these coordinates.
      </span>
    </div>
  );
}

function LocationsPanel({
  data,
  onClose,
  onChanged,
  onSelect,
}: {
  data: Payload;
  onClose: () => void;
  onChanged: () => void;
  onSelect: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(data.locations.length === 0);
  const [err, setErr] = useState<string | null>(null);
  // A shared instance keeps at least one location (the collector needs a target);
  // a signed-in user may unfollow their last one and go back to the setup card.
  const lastShared = data.locations.length <= 1 && !data.caller;

  const post = useCallback(
    async (body: any) => {
      setBusy(true);
      setErr(null);
      try {
        const res = await fetch(`${API}/locations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || `failed (${res.status})`);
        onChanged();
        return true;
      } catch (e: any) {
        setErr(e.message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  return (
    <div className="panel settings">
      <div className="settings-head">
        <strong>Locations</strong>
        <button className="btn secondary" onClick={onClose}>Close</button>
      </div>
      <p className="note" style={{ marginTop: 4 }}>
        Each location is tracked independently in history. NWS and Open-Meteo follow its coordinates
        automatically (closest station / grid cell); PurpleAir uses the sensor you pick here.
        {data.caller && (
          <> Only you see this list. A place someone else also tracks is collected once and shared;
          moving one they follow gives you your own copy instead.</>
        )}
      </p>

      <div className="loc-list">
        {data.locations.map((l) => (
          <div key={l.id} className={`loc-item${l.id === data.location?.id ? " current" : ""}`}>
            {editing === l.id ? (
              <LocationForm
                initial={l}
                submitLabel="Save changes"
                keys={data.keys}
                sourceLabels={data.sourceLabels}
                busy={busy}
                onCancel={() => setEditing(null)}
                onKeySaved={onChanged}
                onSubmit={async (f) => {
                  const ok = await post({ action: "update", id: l.id, ...f });
                  if (ok) setEditing(null);
                }}
              />
            ) : (
              <div className="loc-row">
                <div className="loc-meta">
                  <div className="loc-title">
                    {l.name}
                    {l.id === data.location?.id && <span className="badge">viewing</span>}
                  </div>
                  <div className="muted">
                    {l.lat}, {l.lon}
                    {l.purpleair_sensor_index ? ` · PA #${l.purpleair_sensor_index}` : ""}
                  </div>
                </div>
                <div className="loc-btns">
                  {l.id !== data.location.id && (
                    <button className="btn secondary" disabled={busy} onClick={() => onSelect(l.id)}>View</button>
                  )}
                  <button className="btn secondary" disabled={busy} onClick={() => { setEditing(l.id); setAdding(false); }}>Edit</button>
                  <button
                    className="btn secondary"
                    disabled={busy || lastShared}
                    title={lastShared ? "keep at least one location" : "remove"}
                    onClick={() => post({ action: "remove", id: l.id })}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {adding ? (
        <div className="loc-add">
          <div className="fg-title" style={{ marginBottom: 8 }}>Add a location</div>
          <LocationForm
            submitLabel="Add location"
            keys={data.keys}
            sourceLabels={data.sourceLabels}
            busy={busy}
            onCancel={data.locations.length > 0 ? () => setAdding(false) : undefined}
            onKeySaved={onChanged}
            onSubmit={async (f) => {
              const ok = await post({ action: "add", ...f });
              if (ok) setAdding(false);
            }}
          />
        </div>
      ) : (
        <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => { setAdding(true); setEditing(null); }}>
          + Add location
        </button>
      )}

      {err && <div className="err-msg" style={{ marginTop: 12 }}>{err}</div>}
    </div>
  );
}

// -------------------------------------------------------------- Keys ------

type Origin = "vault" | "saved" | "env" | "none";
type KeyView = { set: boolean; masked: string; origin: Origin };
type KeysView = {
  purpleair: { read_key: KeyView };
  open_meteo?: { api_key: KeyView };
};

function keyHint(k: KeyView): string {
  if (k.origin === "vault") return `in local vault (${k.masked}) — leave blank to keep`;
  if (k.origin === "env") return `from .env.local (${k.masked}) — saving here overrides it`;
  if (k.origin === "saved") return `saved ${k.masked} — leave blank to keep`;
  return "paste key";
}

function KeysPanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [view, setView] = useState<KeysView | null>(null);
  const [paKey, setPaKey] = useState("");
  const [omKey, setOmKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const apply = useCallback((v: KeysView) => {
    setView(v);
    setPaKey("");
    setOmKey("");
  }, []);

  useEffect(() => {
    fetch(`${API}/settings`, { cache: "no-store" })
      .then((r) => r.json())
      .then(apply)
      .catch((e) => setErr(e.message));
  }, [apply]);

  const post = useCallback(
    async (payload: any, okMsg: string) => {
      setBusy(true);
      setErr(null);
      setMsg(null);
      try {
        const res = await fetch(`${API}/settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`save failed (${res.status})`);
        apply(await res.json());
        setMsg(okMsg);
        onSaved();
      } catch (e: any) {
        setErr(e.message);
      } finally {
        setBusy(false);
      }
    },
    [apply, onSaved],
  );

  const saveAll = () => {
    const payload: any = {};
    if (paKey.trim()) payload.purpleair = { read_key: paKey.trim() };
    if (omKey.trim()) payload.open_meteo = { api_key: omKey.trim() };
    if (!payload.purpleair && !payload.open_meteo) {
      setMsg("Nothing to save — the fields were blank.");
      return;
    }
    post(payload, "Saved.");
  };

  if (err && !view) return <div className="panel" style={{ marginTop: 16 }}>Couldn’t load keys: {err}</div>;
  if (!view) return <div className="panel" style={{ marginTop: 16 }}>Loading keys…</div>;

  return (
    <div className="panel settings">
      <div className="settings-head">
        <strong>Account keys</strong>
        <button className="btn secondary" onClick={onClose}>Close</button>
      </div>
      <p className="note" style={{ marginTop: 4 }}>
        Account keys, stored in the local vault (Keychain on macOS). PurpleAir
        sensors are chosen per-location under <em>📍 Locations</em>. Open-Meteo
        works without a key (free non-commercial API); add one if you have a
        commercial / customer endpoint key. From chat, use
        <code>connect_provider</code> — a local browser form, never paste the key into the conversation.
      </p>

      <div className="settings-grid">
        <div className="field-group">
          <div className="fg-title">
            <span className="dot" style={{ background: "#a78bfa" }} /> PurpleAir
          </div>
          <label>READ key</label>
          <input
            type="password"
            autoComplete="off"
            placeholder={keyHint(view.purpleair.read_key)}
            value={paKey}
            onChange={(e) => setPaKey(e.target.value)}
          />
          <div className="fg-help">
            Free READ key at{" "}
            <a href="https://develop.purpleair.com" target="_blank" rel="noreferrer">develop.purpleair.com</a>.
            {["vault", "saved"].includes(view.purpleair.read_key.origin) && (
              <>
                {" · "}
                <button className="linkbtn" disabled={busy} onClick={() => post({ purpleair: { read_key: "" } }, "PurpleAir key cleared.")}>clear</button>
              </>
            )}
          </div>
        </div>
        <div className="field-group">
          <div className="fg-title">
            <span className="dot" style={{ background: "#34d399" }} /> Open-Meteo
          </div>
          <label>API key (optional)</label>
          <input
            type="password"
            autoComplete="off"
            placeholder={keyHint(view.open_meteo?.api_key ?? { set: false, masked: "", origin: "none" })}
            value={omKey}
            onChange={(e) => setOmKey(e.target.value)}
          />
          <div className="fg-help">
            Commercial key at{" "}
            <a href="https://open-meteo.com/en/pricing" target="_blank" rel="noreferrer">open-meteo.com/en/pricing</a>.
            Leave blank to keep using the free API.
            {["vault", "saved"].includes(view.open_meteo?.api_key?.origin ?? "") && (
              <>
                {" · "}
                <button className="linkbtn" disabled={busy} onClick={() => post({ open_meteo: { api_key: "" } }, "Open-Meteo key cleared.")}>clear</button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="settings-actions">
        <button className="btn" onClick={saveAll} disabled={busy}>{busy ? "Saving…" : "Save keys"}</button>
        {msg && <span className="ok-msg">{msg}</span>}
        {err && <span className="err-msg">{err}</span>}
        <span className="note" style={{ marginTop: 0 }}>Then add the sensor to a location under 📍 Locations.</span>
      </div>
    </div>
  );
}

function Leaderboard({ data }: { data: Payload }) {
  const entries = data.sources
    .map((s) => [s, data.outliers[s] || 0] as [string, number])
    .sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return (
    <div className="panel">
      <div className="lead">
        {entries.map(([s, n]) => (
          <div className="bar" key={s}>
            <div className="src">
              <span className="dot" style={{ background: data.sourceColors[s] }} />
              {data.sourceLabels[s] || s}
            </div>
            <div className="track">
              <div className="fill" style={{ width: `${Math.round((100 * n) / max)}%`, background: data.sourceColors[s] }} />
            </div>
            <div className="count">{n}</div>
          </div>
        ))}
      </div>
      <div className="note">
        How often each source was furthest from the group median, across {data.comparisons} metric-snapshots
        (needs 3+ sources reporting a metric at once). More history = more meaningful. Note: “outlier” ≠ “wrong” —
        the odd one out can be the most accurate. PurpleAir is your only truly-local sensor.
      </div>
    </div>
  );
}
