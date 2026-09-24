// Server-side fetchers for each weather source, normalized to a common set of
// imperial units. Each is called with (location) and returns { temp_f,
// humidity, wind_mph, pressure_inhg, pm25, aqi, conditions, place, lat, lon,
// source_url } or throws. place/lat/lon describe where the reading *actually*
// came from — a NWS station, an Open-Meteo grid cell, or the chosen PurpleAir
// sensor; source_url links to that device's own page for verification. Run
// server-side only (keys + CORS).

import { pm25ToAqi } from "./aqi.mjs";
import { WMO } from "./constants.mjs";
import { getJSON } from "./http.mjs";
import { haversineMiles, roundMiles } from "./geo.mjs";
import { providerGetJSON } from "./provider-http.mjs";
import { getProviderSecret, hasProviderSecret } from "./vault.mjs";

// ---- unit helpers ----
const cToF = (c) => (c == null ? null : (c * 9) / 5 + 32);
const kmhToMph = (k) => (k == null ? null : k * 0.621371);
const paToInHg = (pa) => (pa == null ? null : pa * 0.0002953);
const hpaToInHg = (h) => (h == null ? null : h * 0.02953);
const r = (x, n = 1) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** n) / 10 ** n);

// ---------------------------------------------------------------- NWS -------
const NWS_MAX_STATIONS = 8; // closest station may be offline or report a null temp

function buildNwsReading(station, obs, location) {
  const p = obs.properties;
  const v = (k) => (p[k] && p[k].value != null ? p[k].value : null);
  const coords = station.geometry?.coordinates; // GeoJSON order: [lon, lat]
  const sLat = coords ? coords[1] : location.lat;
  const sLon = coords ? coords[0] : location.lon;
  return {
    temp_f: r(cToF(v("temperature"))),
    humidity: r(v("relativeHumidity")),
    wind_mph: r(kmhToMph(v("windSpeed"))),
    pressure_inhg: r(paToInHg(v("barometricPressure")), 2),
    pm25: null,
    aqi: null,
    conditions: p.textDescription || null,
    place: station.properties?.name || null,
    lat: coords ? coords[1] : null,
    lon: coords ? coords[0] : null,
    // Human-readable current conditions page for that station's location.
    source_url: `https://forecast.weather.gov/MapClick.php?lat=${sLat}&lon=${sLon}`,
  };
}

async function fetchNWS(location) {
  const { lat, lon } = location;
  const points = await getJSON(`https://api.weather.gov/points/${lat},${lon}`);
  const stations = await getJSON(points.properties.observationStations);
  const features = stations.features || [];
  if (!features.length) throw new Error(`no NWS observation station near ${location.name}`);

  // Walk outward through the closest stations. Prefer the first that reports an
  // actual temperature — some stations respond but with a null temp (offline
  // sensor), which would otherwise leave the reading and the forecast-accuracy
  // actuals blank. Keep the nearest temperature-less observation as a fallback so
  // we still capture humidity/wind/conditions if none of them have a temp.
  let lastErr;
  let fallback = null;
  for (const station of features.slice(0, NWS_MAX_STATIONS)) {
    try {
      const obs = await getJSON(`${station.id}/observations/latest`);
      const reading = buildNwsReading(station, obs, location);
      if (reading.temp_f != null) return reading; // good: has a temperature
      fallback ||= reading; // remember the nearest temp-less observation
    } catch (e) {
      lastErr = e;
    }
  }
  if (fallback) return fallback; // every nearby station lacked a temp; return nearest
  throw new Error(
    `no current NWS observation near ${location.name} (tried ${Math.min(NWS_MAX_STATIONS, features.length)} stations): ${lastErr?.message || lastErr}`,
  );
}

// ---------------------------------------------------------- Open-Meteo ------
async function fetchOpenMeteo(location) {
  const { lat, lon } = location;
  const forecastUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,surface_pressure,weather_code` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph`;
  const forecast = await providerGetJSON("open_meteo", forecastUrl);
  const cur = forecast.current;

  let pm25 = null, aqi = null;
  try {
    const aqUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&current=pm2_5,us_aqi`;
    const aq = (await providerGetJSON("open_meteo", aqUrl)).current;
    pm25 = r(aq.pm2_5);
    aqi = aq.us_aqi ?? null;
  } catch {
    /* air-quality is best-effort */
  }

  return {
    temp_f: r(cur.temperature_2m),
    humidity: r(cur.relative_humidity_2m),
    wind_mph: r(cur.wind_speed_10m),
    pressure_inhg: r(hpaToInHg(cur.surface_pressure), 2),
    pm25,
    aqi,
    conditions: WMO[cur.weather_code] ?? (cur.weather_code != null ? `code ${cur.weather_code}` : null),
    place: null, // gridded model, no station name
    lat: forecast.latitude ?? null, // the grid cell Open-Meteo snapped to
    lon: forecast.longitude ?? null,
    source_url: forecastUrl, // the exact API call — clicking shows the live JSON
  };
}

// ----------------------------------------------------------- PurpleAir ------
// The user picks a specific sensor per location (location.purpleair_sensor_index);
// the account read key is global.
async function fetchPurpleAir(location) {
  const sensor_index = location.purpleair_sensor_index;
  if (!(await hasProviderSecret("purpleair"))) throw new Error("PurpleAir read key missing");
  if (!sensor_index) throw new Error("no PurpleAir sensor selected for this location");
  const data = await providerGetJSON(
    "purpleair",
    `https://api.purpleair.com/v1/sensors/${sensor_index}?fields=temperature,humidity,pressure,pm2.5_atm,latitude,longitude,name`,
  );
  const s = data.sensor || {};
  // PurpleAir sensors read ~8°F warm and ~4% RH dry; apply the common correction.
  const temp = s.temperature == null ? null : s.temperature - 8;
  const hum = s.humidity == null ? null : s.humidity + 4;
  const pm = s["pm2.5_atm"] ?? null;
  return {
    temp_f: r(temp),
    humidity: r(hum),
    wind_mph: null, // PurpleAir has no wind sensor
    pressure_inhg: r(hpaToInHg(s.pressure), 2), // PurpleAir pressure is in millibar == hPa
    pm25: r(pm),
    aqi: pm25ToAqi(pm),
    conditions: null,
    place: s.name || null,
    lat: s.latitude ?? null,
    lon: s.longitude ?? null,
    // The public map, selecting this sensor and centering on it (#zoom/lat/lon).
    source_url:
      s.latitude != null && s.longitude != null
        ? `https://map.purpleair.com/?select=${sensor_index}#14/${s.latitude}/${s.longitude}`
        : `https://map.purpleair.com/?select=${sensor_index}`,
  };
}

// Nearby recently-reporting OUTDOOR PurpleAir sensors, closest first. Used to
// auto-fill a location's sensor index (dashboard + MCP). Queries the bounding-box
// sensors endpoint (location_type=0 = outdoor; max_age skips stale sensors).
// Returns [{ sensor_index, name, lat, lon, distance_mi, confidence, last_seen,
// source_url }, ...] (possibly empty). Reads column order from the response's
// own `fields` array, so it's robust to PurpleAir reordering them.
export async function findNearbyPurpleAir(point, { radiusMi = 10, maxAgeSec = 3600, limit = 5 } = {}) {
  if (!(await hasProviderSecret("purpleair"))) throw new Error("PurpleAir read key missing");
  const { lat, lon } = point;
  if (lat == null || lon == null) throw new Error("lat/lon required");

  // Bounding box around the point: ~69 mi per degree of latitude; longitude degrees
  // shrink by cos(latitude). The clamp avoids a divide-by-zero near the poles.
  const dLat = radiusMi / 69;
  const dLon = radiusMi / (69 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const params = new URLSearchParams({
    fields: "latitude,longitude,name,location_type,confidence,last_seen",
    nwlng: String(lon - dLon),
    nwlat: String(lat + dLat),
    selng: String(lon + dLon),
    selat: String(lat - dLat),
    location_type: "0", // outdoor only
    max_age: String(maxAgeSec), // exclude sensors that haven't reported recently
  });
  const data = await providerGetJSON(
    "purpleair",
    `https://api.purpleair.com/v1/sensors?${params.toString()}`,
  );

  const fields = Array.isArray(data.fields) ? data.fields : [];
  const col = (name) => fields.indexOf(name);
  const iId = col("sensor_index"); // always present, first column
  const iLat = col("latitude"), iLon = col("longitude"), iName = col("name");
  const iConf = col("confidence"), iSeen = col("last_seen");
  const rows = Array.isArray(data.data) ? data.data : [];

  const found = [];
  for (const row of rows) {
    const sLat = row[iLat], sLon = row[iLon];
    const dist = haversineMiles(point, { lat: sLat, lon: sLon });
    if (dist == null) continue;
    const sensor_index = String(row[iId]);
    found.push({
      sensor_index,
      name: iName >= 0 ? row[iName] ?? null : null,
      lat: sLat,
      lon: sLon,
      confidence: iConf >= 0 ? row[iConf] ?? null : null,
      last_seen: iSeen >= 0 ? row[iSeen] ?? null : null,
      distance_mi: roundMiles(dist),
      source_url: `https://map.purpleair.com/?select=${sensor_index}#14/${sLat}/${sLon}`,
    });
  }
  found.sort((a, b) => a.distance_mi - b.distance_mi);
  return found.slice(0, Math.max(1, limit));
}

export async function findNearestPurpleAir(point, opts = {}) {
  const [best] = await findNearbyPurpleAir(point, { ...opts, limit: 1 });
  return best ?? null;
}

export const FETCHERS = {
  nws: fetchNWS,
  open_meteo: fetchOpenMeteo,
  purpleair: fetchPurpleAir,
};

// Which sources can run for a given location: NWS/Open-Meteo always (they derive
// from lat/lon); PurpleAir only when both the global read key and that location's
// chosen sensor index are present.
export async function enabledSourcesFor(location) {
  const list = ["nws", "open_meteo"];
  if ((await getProviderSecret("purpleair")) && location.purpleair_sensor_index) list.push("purpleair");
  return list;
}

// Collect every enabled source for one location.
// Returns { ts, results: { source: {...,status} } }.
export async function collectLocation(location) {
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const keys = await enabledSourcesFor(location);
  const settled = await Promise.allSettled(keys.map((k) => FETCHERS[k](location)));
  const results = {};
  keys.forEach((key, i) => {
    const s = settled[i];
    results[key] =
      s.status === "fulfilled"
        ? { ...s.value, status: "ok" }
        : { status: "error", error: String(s.reason?.message || s.reason) };
  });
  return { ts, results };
}
