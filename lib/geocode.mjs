// Place search for "add a location by name." Proxies OpenStreetMap Nominatim
// (no key). Nominatim's usage policy requires a descriptive User-Agent and
// ~1 req/sec; callers (dashboard typeahead, MCP search_places) are user-initiated.
// Attribution: results are © OpenStreetMap contributors.

import { UA } from "./http.mjs";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

function conciseName(r) {
  const a = r.address || {};
  const street = [a.house_number, a.road].filter(Boolean).join(" ");
  const place = a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || a.county || "";
  const head = street || a.neighbourhood || r.name || place;
  const parts = [
    head,
    place && place !== head ? place : null,
    a.state,
    (a.country_code || "").toUpperCase(),
  ].filter(Boolean);
  return parts.join(", ") || r.display_name || "";
}

const ATTRIBUTION = "© OpenStreetMap contributors";
const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";

function placeFromNominatim(r, fallbackLat, fallbackLon) {
  const name = conciseName(r);
  const lat = parseFloat(r.lat);
  const lon = parseFloat(r.lon);
  if (name && Number.isFinite(lat) && Number.isFinite(lon)) return { name, lat, lon };
  if (Number.isFinite(fallbackLat) && Number.isFinite(fallbackLon)) {
    return { name: name || `${fallbackLat.toFixed(4)}, ${fallbackLon.toFixed(4)}`, lat: fallbackLat, lon: fallbackLon };
  }
  return null;
}

export async function searchPlaces(q, { limit = 6 } = {}) {
  const query = String(q || "").trim();
  if (query.length < 2) return { results: [], attribution: ATTRIBUTION };

  const url =
    `${NOMINATIM}?q=${encodeURIComponent(query)}` +
    `&format=jsonv2&addressdetails=1&limit=${Math.min(12, Math.max(1, limit))}&dedupe=1&accept-language=en`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`geocoding HTTP ${res.status}`);
  const data = await res.json();
  const results = (Array.isArray(data) ? data : [])
    .map((r) => placeFromNominatim(r))
    .filter(Boolean);
  return { results, attribution: ATTRIBUTION };
}

// Name a lat/lon for "use my location." Callers should keep the browser's
// coordinates and use `result.name` as the display label — Nominatim may snap
// to a nearby street point.
export async function reverseGeocode(lat, lon) {
  const la = typeof lat === "number" ? lat : parseFloat(lat);
  const lo = typeof lon === "number" ? lon : parseFloat(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) {
    return { result: null, attribution: ATTRIBUTION };
  }

  const url =
    `${NOMINATIM_REVERSE}?lat=${encodeURIComponent(la)}&lon=${encodeURIComponent(lo)}` +
    `&format=jsonv2&addressdetails=1&zoom=18&accept-language=en`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`reverse geocoding HTTP ${res.status}`);
  const data = await res.json();
  if (!data || data.error) return { result: null, attribution: ATTRIBUTION };
  return { result: placeFromNominatim(data, la, lo), attribution: ATTRIBUTION };
}
