---
name: weather-compare-location-model
description: How weather-compare models locations and per-source devices
metadata:
  type: project
---

weather-compare went from a single hard-coded `LOCATION_*` to **user-managed
locations** (2026-06-16). Model:

- Locations live in `settings.json`: `{ id, name, lat, lon,
  purpleair_sensor_index, wu_station_id }`, plus `activeLocationId`. Seeded with a
  `default` location (id `"default"`) from `LOCATION_*` env or SF.
- **NWS + Open-Meteo** derive purely from each location's lat/lon — they
  auto-pick the closest station / grid cell. (User clarified the "closest sensor"
  ask was only about these two.)
- **PurpleAir** uses a user-chosen sensor *per location* (`purpleair_sensor_index`
  on the location). The read key is global, in `settings.json` under `purpleair`.
- **Weather Underground was removed** (2026-06-16) — it's a paid service. The
  fetcher, key, and per-location `wu_station_id` are all gone. If re-adding, mirror
  the PurpleAir pattern (global key + per-location station id).
- History (`history.json`) is partitioned by `loc_id`; legacy rows with no
  `loc_id` are attributed to the `default` location so nothing is orphaned.
- Search in the Locations panel is a **debounced typeahead** backed by
  `/api/geocode`, which proxies **OpenStreetMap Nominatim** (switched from
  Open-Meteo geocoding 2026-06-16 — Open-Meteo missed small towns like
  "Lafayette, CA"). Handles **city or full street address** (conciseName leads with
  house number + road for addresses). Nominatim needs a descriptive User-Agent and
  ~1 req/sec; the route sets the UA and the client debounces 350ms + cancels
  in-flight requests. Show "© OpenStreetMap contributors" attribution.
- `/api/stations?lat=&lon=&purpleair_sensor_index=` does a throwaway
  `collectLocation` (live fetch, NOT stored) and returns each source's actual
  station/sensor + great-circle distance. Surfaced as "📏 Check station distances"
  in the add/edit form so you can see how far stations are from a precise address.
- Each fetcher returns a `source_url` (persisted) linking the device's own page for
  verification: NWS → `forecast.weather.gov/MapClick.php?lat=&lon=` (station coords),
  Open-Meteo → the exact forecast API URL, PurpleAir →
  `map.purpleair.com/?select=<idx>#14/<lat>/<lon>` (the hash centers the map on the
  sensor; `?select` alone leaves it world-zoomed). The dashboard Location row + the
  distance-check preview link the device name to it.

**Per-user views (2026-09-14).** With `WEATHER_IDENTITY_HEADER` set (platform:
`X-Forwarded-User`, from Caddy `forward_auth copy_headers` ← gateway
`/session/verify`), every request carries a caller. `lib/scope.mjs` narrows the
shared pool to the caller's **follows** (`users/<slug>.json` next to
settings.json: `{ follows, activeLocationId }`, slug = gateway `userSlug` rule).
Rules in `lib/location-actions.mjs`: add reuses a pool entry at the same spot +
sensor; rename in place; a move of a shared entry forks it; remove unfollows and
retires only an unfollowed entry; select is per user. Anonymous instances are
unchanged. The header switcher **never** writes the shared `activeLocationId`
anymore (per-browser URL/localStorage, plus per-user server-side when signed
in). Collections take a lock file (`history.json.lock`) across processes.
`scripts/seed-users.mjs` pre-fills follows for existing people. The MCP tools
stay pool-wide (no identity available to a capability by design).

**Why:** different cities need different physical sensors but the same account
keys. Related: [[multi-sensor-triangulation-idea]].
