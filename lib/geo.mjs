// Shared geo helpers. Used by sources.mjs (pick the closest sensor to a location)
// and payload.mjs (how far each reading sits from its location).

// Great-circle distance in miles, or null if either point lacks coordinates.
export function haversineMiles(a, b) {
  if (a?.lat == null || a?.lon == null || b?.lat == null || b?.lon == null) return null;
  const R = 3958.7613; // Earth radius, miles
  const toRad = (d) => (d * Math.PI) / 180;
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function roundMiles(d) {
  return d == null ? null : Math.round(d * 10) / 10;
}
