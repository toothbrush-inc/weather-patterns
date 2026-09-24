// Metrics every source is normalized down to, plus display metadata.

// Locations are user-managed now. Pre-existing history (rows with no loc_id) and
// a fresh install both fall back to this default location, so nothing is orphaned.
export const DEFAULT_LOC_ID = "default";
export const DEFAULT_LOCATION = { id: DEFAULT_LOC_ID, name: "San Francisco, CA", lat: 37.7749, lon: -122.4194 };

export const METRICS = ["temp_f", "humidity", "wind_mph", "pressure_inhg", "pm25", "aqi"];

export const METRIC_LABELS = {
  temp_f: "Temp (°F)",
  humidity: "Humidity (%)",
  wind_mph: "Wind (mph)",
  pressure_inhg: "Pressure (inHg)",
  pm25: "PM2.5 (µg/m³)",
  aqi: "US AQI",
};

export const SOURCE_LABELS = {
  nws: "NWS (weather.gov)",
  open_meteo: "Open-Meteo",
  purpleair: "PurpleAir",
};

export const SOURCE_COLORS = {
  nws: "#4fa3ff",
  open_meteo: "#34d399",
  purpleair: "#a78bfa",
};

// % chance of precipitation at which the day "counts" as a rain day — the
// heads-up card fires (lib/alerts.mjs) and the dashboard's sky icon turns to
// rain (app/page.tsx condIcon). One number so the two never disagree.
export const RAIN_PROB = 40;

// Plain-language temperature bands, labelled down the right edge of the
// three-day comparison chart (lib/temperature-scale.ts). Each entry is the
// band's floor in °F; a temperature belongs to the highest floor it reaches.
// "Hot" is regional — retune here and the chart follows.
export const TEMP_BANDS = [
  { floor: 100, label: "Very hot" },
  { floor: 90, label: "Hot" },
  { floor: 80, label: "Warm" },
  { floor: 70, label: "Mild" },
  { floor: 60, label: "Cool" },
  { floor: 50, label: "Chilly" },
  { floor: 40, label: "Cold" },
  { floor: 32, label: "Very cold" },
  { floor: -Infinity, label: "Freezing" },
];

// WMO weather interpretation codes (Open-Meteo). Shared by current-conditions
// fetchers and daily forecasts so MCP/dashboard see the same labels.
export const WMO = {
  0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog",
  48: "Rime fog", 51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 71: "Light snow", 73: "Snow",
  75: "Heavy snow", 80: "Rain showers", 81: "Rain showers", 82: "Heavy showers",
  95: "Thunderstorm", 96: "Thunderstorm + hail", 99: "Severe thunderstorm",
};

// "How far apart is too far?" thresholds: [green<=, amber<=], else red.
export const SPREAD_THRESHOLDS = {
  temp_f: [2, 5],
  humidity: [8, 20],
  wind_mph: [3, 8],
  pressure_inhg: [0.05, 0.15],
  pm25: [5, 15],
  aqi: [15, 40],
};
