// Pure weather alert rules. No disk or network access.
import { RAIN_PROB } from "./constants.mjs";
const RAIN_PROB_HIGH = 70;
const RAIN_IN = 0.05; // inches expected that counts even at lower probability
const RAIN_IN_HIGH = 0.25;
const WIND_ABS = 20; // sustained mph that's notable anywhere
const WIND_ABS_HIGH = 30;
const GUST_ABS = 30;
const GUST_ABS_HIGH = 45;
const AQI_SENSITIVE = 101; // US AQI bands: unhealthy for sensitive groups / unhealthy
const AQI_UNHEALTHY = 151;
// … and the "outside YOUR normal" margins on top of the trailing window.
const WIND_OVER_TYPICAL = 8; // mph above the 30-day p95 before "windier than usual"
const WIND_UNUSUAL_FLOOR = 12; // but never alert under this — light wind is never news
const AQI_OVER_TYPICAL = 25; // AQI points above the 30-day p95
const AQI_UNUSUAL_FLOOR = 60;
const TEMP_ANOM_MIN = 8; // °F beyond the recent normal high/low before it's abnormal
const TEMP_ANOM_HIGH = 15; // this far beyond escalates to a warning
const MIN_READINGS = 50; // history depth before percentile baselines are trusted
const MIN_DAYS = 5; // completed days before temp normals are trusted

const fmtHour = (h) => {
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${h >= 12 ? "pm" : "am"}`;
};

/** @param {{consensus: any, forecasts?: Record<string, any>, hours?: Array<any>, aqiToday?: any, stats?: any}} input */
export function buildAlerts({ consensus, forecasts = {}, hours = [], aqiToday = null, stats = null }) {
  const alerts = [];
  const conditions = Object.values(forecasts)
    .map((f) => (f?.status === "ok" ? f.conditions : null))
    .filter(Boolean)
    .join(" / ");

  // --- precipitation ---------------------------------------------------------
  const prob = consensus?.precip_prob ?? null;
  const inches = consensus?.precip_in ?? null;
  if (/thunder|t-?storm/i.test(conditions)) {
    alerts.push({
      kind: "storm", severity: "warning", icon: "⛈️", headline: "Thunderstorms possible today",
      detail: rainDetail(prob, inches, hours),
    });
  } else if (/snow|sleet|freezing|blizzard/i.test(conditions)) {
    alerts.push({
      kind: "snow", severity: "warning", icon: "🌨️", headline: "Snow or ice possible today",
      detail: rainDetail(prob, inches, hours),
    });
  } else if ((prob != null && prob >= RAIN_PROB) || (inches != null && inches >= RAIN_IN)) {
    alerts.push({
      kind: "rain",
      severity: (prob ?? 0) >= RAIN_PROB_HIGH || (inches ?? 0) >= RAIN_IN_HIGH ? "warning" : "notice",
      icon: "🌧️",
      headline: (prob ?? 0) >= RAIN_PROB_HIGH ? "Rain expected today" : "Rain likely today",
      detail: rainDetail(prob, inches, hours),
    });
  }

  // --- wind -------------------------------------------------------------------
  let wMax = null, wHour = null, gMax = null;
  for (const h of hours) {
    if (h.wind_mph != null && (wMax == null || h.wind_mph > wMax)) { wMax = h.wind_mph; wHour = h.hour; }
    if (h.gust_mph != null && (gMax == null || h.gust_mph > gMax)) gMax = h.gust_mph;
  }
  if (wMax != null) {
    const typical = stats && stats.wind.n >= MIN_READINGS ? stats.wind.p95 : null;
    const strong = wMax >= WIND_ABS || (gMax ?? 0) >= GUST_ABS;
    const unusual = typical != null && wMax >= typical + WIND_OVER_TYPICAL && wMax >= WIND_UNUSUAL_FLOOR;
    if (strong || unusual) {
      const gustTxt = gMax != null && gMax > wMax ? `, gusts ~${Math.round(gMax)}` : "";
      const typTxt = typical != null ? ` A typical windy moment here is ~${Math.round(typical)} mph.` : "";
      alerts.push({
        kind: "wind",
        severity: wMax >= WIND_ABS_HIGH || (gMax ?? 0) >= GUST_ABS_HIGH ? "warning" : "notice",
        icon: "💨",
        headline: strong ? "High wind today" : "Windier than usual today",
        detail: `Winds to ~${Math.round(wMax)} mph${gustTxt} around ${fmtHour(wHour)}.${typTxt}`,
      });
    }
  }

  // --- air quality --------------------------------------------------------------
  const aMax = aqiToday?.max ?? null;
  if (aMax != null) {
    const typical = stats && stats.aqi.n >= MIN_READINGS ? stats.aqi.p95 : null;
    const bad = aMax >= AQI_SENSITIVE;
    const unusual = typical != null && aMax >= typical + AQI_OVER_TYPICAL && aMax >= AQI_UNUSUAL_FLOOR;
    if (bad || unusual) {
      const when = aqiToday.maxHour != null ? ` around ${fmtHour(aqiToday.maxHour)}` : "";
      const typTxt = typical != null ? ` Typical here is under ${Math.round(typical)}.` : "";
      alerts.push({
        kind: "aqi",
        severity: aMax >= AQI_UNHEALTHY ? "warning" : "notice",
        icon: "😷",
        headline:
          aMax >= AQI_UNHEALTHY ? "Unhealthy air quality today"
          : aMax >= AQI_SENSITIVE ? "Air unhealthy for sensitive groups today"
          : "Air quality worse than usual today",
        detail: `US AQI expected to reach ~${aMax}${when}.${typTxt}`,
      });
    }
  }

  // --- abnormal temperature -------------------------------------------------------
  if (stats) {
    const hi = consensus?.high_f ?? null;
    if (hi != null && stats.high.n >= MIN_DAYS) {
      const bar = Math.max(TEMP_ANOM_MIN, 2 * (stats.high.sd ?? 0));
      const over = hi - stats.high.mean;
      if (over >= bar) {
        alerts.push({
          kind: "heat",
          severity: over >= bar + TEMP_ANOM_HIGH - TEMP_ANOM_MIN || hi >= 100 ? "warning" : "notice",
          icon: "🥵",
          headline: "Much hotter than normal today",
          detail: `Forecast high ${hi}° vs a recent normal of ~${Math.round(stats.high.mean)}°.`,
        });
      }
    }
    const lo = consensus?.low_f ?? null;
    if (lo != null && stats.low.n >= MIN_DAYS) {
      const bar = Math.max(TEMP_ANOM_MIN, 2 * (stats.low.sd ?? 0));
      const under = stats.low.mean - lo;
      if (under >= bar) {
        alerts.push({
          kind: "cold",
          severity: under >= bar + TEMP_ANOM_HIGH - TEMP_ANOM_MIN || lo <= 20 ? "warning" : "notice",
          icon: "🥶",
          headline: "Much colder than normal tonight",
          detail: `Forecast low ${lo}° vs a recent normal of ~${Math.round(stats.low.mean)}°.`,
        });
      }
    }
  }

  // Warnings first — they're why the section exists.
  return alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warning" ? -1 : 1));
}

// "~65% chance, about 0.3″ expected, starting around 2pm." — whichever parts exist.
function rainDetail(prob, inches, hours) {
  const parts = [];
  if (prob != null) parts.push(`~${prob}% chance`);
  if (inches != null && inches >= 0.01) parts.push(`about ${inches}″ expected`);
  const start = hours.find((h) => (h.precip_prob ?? 0) >= RAIN_PROB);
  if (start) parts.push(`starting around ${fmtHour(start.hour)}`);
  return parts.length ? `${parts.join(", ")}.` : null;
}
