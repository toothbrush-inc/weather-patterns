# Weather Patterns

**Personalized weather service. Get accurate, hyperlocal forecasts for your
location.**

A more accurate forecast for the exact place you stand. Weather Patterns pulls
current conditions and daily forecasts from the National Weather Service,
Open-Meteo, and a PurpleAir sensor near you, logs every reading to a local
history file, and scores each forecast against what actually happened outside
your window. Over time it learns your microclimate: which source runs warm or
cool for your spot and by how much, and it adjusts today's forecast to match.

## Two ways to use it

| Use it at the store | Run it yourself |
|---|---|
| Open `https://toys.thephotobase.com/weather` and sign in with Google. Nothing to install and no keys to manage: the store's broker holds them and attaches them only to the weather services it allows. The same apps work from your AI assistant, with one sign-in. | Open source. Clone the repo, `npm install`, and run it on your own machine with your own keys and your own history file. Everything from the [quick start](#quick-start) down is about this path. |


## How it works

1. You add the places you care about, by city name, street address, or
   coordinates. NWS and Open-Meteo follow those coordinates automatically. For
   PurpleAir you pick a specific sensor per place.
2. A collector takes a snapshot on a schedule: every enabled source is fetched,
   normalised to the same units, and appended to `history.json`. Each snapshot
   also logs every source's forecast for tomorrow.
3. The dashboard shows the latest readings side by side, the spread between
   them, and an outlier leaderboard of who disagrees most often.
4. Once a forecast day has passed, it is scored against what was observed, so
   the accuracy section fills in with which source forecasts best for your spot.

Sources:

| Source | Key needed | Provides |
|---|---|---|
| **NWS** (weather.gov) | none | temp, humidity, wind, pressure, conditions (US only) |
| **Open-Meteo** | none | temp, humidity, wind, pressure, conditions + a US-AQI estimate |
| **PurpleAir** | free READ key + sensor index | PM2.5 / AQI + local temp, humidity, pressure (no wind) |

> NWS and Open-Meteo work out of the box. PurpleAir lights up once you add a READ
> key and pick a sensor for a location.

## What you get

- **Don't get fooled by a single forecast, get the full picture in one place.**
  Current conditions and daily forecasts from the National Weather Service,
  Open-Meteo and a PurpleAir sensor near you, side by side, with a consensus
  and the spread between them. Once a few days have been scored, each source's
  systematic miss at your spot is cancelled out, so the high and low you see
  are fitted to your street rather than the nearest airport.
- **Easily compare weather data and forecasts to see how the weather is
  actually trending.** Observed readings and every source's forecast on one
  chart, plus an hour-by-hour curve fitted to how your spot actually warms and
  cools, so the shape of today and tomorrow holds up even when the sources miss.
- **Get a heads up when the weather is out of the ordinary.** Every collection
  logs tomorrow's forecast, so you see when a source expects a departure from
  the usual pattern and, later, how far off it was.
- **See which source gets your spot right.** Each source's 1-day-ahead forecast
  is scored against what actually happened, both its own observed high and low
  and your PurpleAir sensor, and reported as average miss and bias. See
  [Forecast accuracy](#forecast-accuracy-1-day-ahead) for how the scoring works.
- **Who is the odd one out.** For every metric reported by three or more
  sources, the one furthest from the group median gets a point. Over time the
  leaderboard shows who disagrees most, with the caveat that disagreement is not
  the same as being wrong. See
  [How divergence works](#how-divergence--which-to-favor-works).
- **Are the sources even in the same place?** The dashboard shows each source's
  real station or sensor location and its distance from your point, and warns
  when one is far enough away that the readings are not comparable. See
  [Are the sources even in the same place?](#are-the-sources-even-in-the-same-place).

## Quick start

```bash
cd weather-patterns
npm install
cp .env.local.example .env.local   # then edit it (see below)
npm run dev          # http://localhost:3002
```

On the dashboard click **“↻ Collect now”** to take the first snapshot. Each click
fetches every enabled source, stores it, and updates the side-by-side table,
charts, and outlier leaderboard.

### Configuration

Everything is configured in the dashboard now; `.env.local` only sets the starting
defaults.

#### Locations (in the dashboard)

Click **📍 Locations** to manage the places you track. The search box is a typeahead
backed by OpenStreetMap's Nominatim geocoder (© OpenStreetMap contributors): type a
**city or full street address** and pick a result to fill in precise coordinates (or
type lat/lon directly). Each location is tracked independently in history, and the
switcher in the header flips the whole dashboard between them.

- **NWS** and **Open-Meteo** follow each location's coordinates automatically — they
  pick the closest observation station / grid cell, no configuration needed.
- **PurpleAir** uses a sensor *you choose per location*: set the **sensor index** on
  that location. (A sensor in one city is different from one in another, so it lives
  on the location, not globally.)
- **📏 Check station distances** (in the add/edit form) does a live lookup and shows
  how far each source's actual station/sensor is from that exact point — handy for a
  precise address. The dashboard's **Location** row shows the same distances for the
  collected data, and each device name there **links to its source page** (NWS
  current-conditions page, the Open-Meteo API call, the PurpleAir sensor on the map)
  so you can double-check the reading.

#### Keys (in the dashboard)

Click **⚙ Keys** to add your PurpleAir READ key. It's a global account key; the
per-location sensor index above decides which sensor it reads. Keys are stored
in the OSS vault package [`@dvd-toy-box/vault`](https://github.com/toothbrush-inc/toy-box-vault)
(`~/Library/Application Support/local-vault` / Keychain on macOS; XDG or
`%APPDATA%` elsewhere). If you also run CalSync, it's the same home. Existing
keys in `settings.json` or `.env.local` still work as a read fallback until you
save again. Locations stay in `settings.json`; secrets do not.

#### `.env.local` (optional starting defaults)

```ini
# Seeds the first ("default") location on a fresh install; edit locations in the UI after.
LOCATION_NAME="San Francisco, CA"
LOCATION_LAT=37.7749
LOCATION_LON=-122.4194

# PurpleAir READ key — https://develop.purpleair.com  (account-wide)
PURPLEAIR_READ_KEY=

# Optional: shared secret so only you can trigger /api/collect from cron
COLLECT_TOKEN=
```

A source with no key (or no device chosen for the current location) shows as “no
key” / “no sensor here” and is skipped — nothing breaks.

## Use it from your assistant

Weather Patterns can run as a **local stdio MCP server** so Cursor or Claude Desktop can
query collected history and live forecasts. Same `settings.json` /
`history.json` / `forecasts.json` as the dashboard and collector. Tool results
are typed JSON (high/low, conditions, spreads, accuracy stats) — never prose,
never API keys. PurpleAir / Open-Meteo keys are stored in the shared local vault
(`~/Library/Application Support/local-vault`, same home as CalSync), not in the
chat transcript. `connect_provider` opens a loopback browser form; only the
link it returns serves the form (it carries a one-time state), and a bare visit
to the path shows an expired page, so put the whole link in front of the user
and, in hosted mode, make sure the proxy forwards the query string. Fetchers read
keys from the vault (then `settings.json` / `.env.local` as a fallback). The
vault is the OSS package [`@dvd-toy-box/vault`](https://github.com/toothbrush-inc/toy-box-vault)
(`npm install` pulls it in). You do not need a CalSync checkout.

At the store, the same tools are reachable through the store's MCP address with
your store sign-in. This app has no hosted MCP endpoint of its own.

Add a server to Cursor's `mcp.json` (project `.cursor/mcp.json` or
`~/.cursor/mcp.json`). Set `cwd` to this repository so the JSON stores resolve:

```json
{
  "mcpServers": {
    "weather-patterns": {
      "command": "node",
      "args": ["/absolute/path/to/weather-patterns/mcp/server.mjs"],
      "cwd": "/absolute/path/to/weather-patterns"
    }
  }
}
```

Or `npm run mcp` from this directory. Logs go to stderr only; do not point stdout
at a log file. After changing tools, disable and re-enable **weather-patterns**
under Cursor Settings → MCP (or reload the window) so Cursor respawns the process.

### Tools

| Tool | What it does | Reads / writes |
|---|---|---|
| `get_forecast` | Daily high/low, conditions and precipitation per source plus a consensus, for today or up to 7 days. The one to call for “what will the weather be like today?” | reads (live fetch) |
| `get_current` | Latest collected observations per source for a location, from the history ledger. | reads |
| `compare_sources` | Side-by-side latest readings, per-metric spread, and the outlier leaderboard. | reads |
| `forecast_accuracy` | 1-day-ahead accuracy from the ledger: average miss and bias per source, plus today's provisional score. | reads |
| `query_history` | Collected snapshots for a location over a trailing window (default 48 hours). | reads |
| `get_status` | Configured locations, enabled sources, last snapshot time, and masked key status. | reads |
| `search_places` | Geocode a city or street address to candidate coordinates (OpenStreetMap Nominatim). | reads (live fetch) |
| `find_purpleair_sensors` | Nearby outdoor PurpleAir sensors for a location or point; needs a PurpleAir key. | reads (live fetch) |
| `add_location` | Add a tracked location by place name or coordinates, optionally attaching the nearest PurpleAir sensor. | writes |
| `update_location` | Rename or move a location, or set its PurpleAir sensor index. | writes |
| `remove_location` | Stop tracking a location. History rows are kept. | writes |
| `connect_provider` | Start connecting a PurpleAir READ key or optional Open-Meteo customer key via a local browser form. Never pass the key in chat. | writes (vault) |
| `collect_now` | Take one collection snapshot now and log tomorrow's forecast. | writes |
| `request_capability` | Record an ask the tools cannot satisfy, for the backlog. | writes |

The collector still runs on its schedule (`npm run collect`, launchd, or the
in-process scheduler). MCP does not replace it — it reads what has been
collected, and `collect_now` takes one extra snapshot.

## Privacy and data

**What is stored, and where.** Append-only JSON at `history.json` (override with
`WEATHER_DB`). One row per source per snapshot, tagged with its `loc_id` so every
location keeps its own history in the one file. Zero native dependencies, so it
installs cleanly anywhere. Locations live in `settings.json` (override with
`WEATHER_SETTINGS`). Logged forecasts live in `forecasts.json`. Account API keys
live in [`@dvd-toy-box/vault`](https://github.com/toothbrush-inc/toy-box-vault), never in the
history or settings files, and tool results strip them before anything reaches
the chat.

**What leaves your machine.** Only requests to the weather services themselves:
`api.weather.gov` (NWS), `api.open-meteo.com` and its air-quality and archive
hosts, `api.purpleair.com`, and OpenStreetMap's Nominatim for place search.
Coordinates go out; nothing else about you does. Under the gateway, keys are
attached by the broker only to the hosts declared in
[`capability.json`](capability.json), so a key can never be sent anywhere else.

**Deploying to Vercel/serverless?** The filesystem there is ephemeral. Swap the three
functions in `lib/db.mjs` (`insertSnapshot(ts, location, results)`,
`getHistory(locId)`, `countReadings(locId)`) for a hosted store — Postgres, Turso
(libSQL), or Upstash Redis. Nothing else changes; those three signatures are the
entire storage contract. Then use Vercel Cron to hit `/api/collect?token=...` on a
schedule.

## Logging history automatically

The whole point is accumulating divergence (and forecast accuracy) over time, so
collect on a schedule. Two ways, depending on how you run it:

- **Deployed instance (Docker / PaaS) — nothing to set up.** The server runs a
  built-in scheduler that collects every `COLLECT_INTERVAL_MINUTES` (default 30;
  set `0` to disable). This is the recommended path — see
  [Deploy for remote access](#deploy-for-remote-access).
- **Running locally, or you prefer an external scheduler.** The collector is also a
  standalone script — **no running server needed**. Locations come from
  `settings.json`; API keys come from the vault (or leftover `settings.json` /
  `.env.local`):

```bash
npm run collect          # = node --env-file-if-exists=.env.local scripts/collect.mjs
```

Then drive it with launchd (Option A) or cron (Option B):

### Option A — macOS `launchd` (runs even when nothing is open; recommended)

A launchd template, `com.weather.patterns.plist`, is in the project root. Fill in
your Node binary and this checkout's path, then install it:

```bash
sed -e "s|__NODE__|$(which node)|" -e "s|__PROJECT_DIR__|$PWD|" \
  com.weather.patterns.plist > ~/Library/LaunchAgents/com.weather.patterns.plist
launchctl load ~/Library/LaunchAgents/com.weather.patterns.plist   # runs now + every 30 min
```

Check it: `launchctl list | grep weather` and `tail -f /tmp/weather-patterns.log`.
Stop it: `launchctl unload ~/Library/LaunchAgents/com.weather.patterns.plist`.
Note (nvm): the installed plist hardcodes the Node binary path; if you upgrade Node,
re-run the `sed` line above.

### Option B — `cron`

```cron
*/30 * * * * cd /path/to/weather-patterns && /path/to/node scripts/collect.mjs >> /tmp/weather-patterns.log 2>&1
```

(On recent macOS, `cron` needs Full Disk Access; `launchd` is the smoother path.)

### Viewing vs collecting

The collector only **writes** data. To **view** the dashboard, run `npm run dev` and
open <http://localhost:3002> when you want to look — it reads the same files the
collector wrote, so the two are independent.

A good cadence is every 15–30 minutes. History is capped to the most recent 500
snapshots in the dashboard view (the JSON file keeps everything).

## Deploy for remote access

This is a **single-tenant** app: you run **your own instance** with your own
locations, keys, and history. There's no shared server and no accounts — which
keeps it low-maintenance and means your API keys never leave your deployment.

Two things follow from that and are worth knowing even on a lone instance:

- **The location you're viewing is a browser preference**, kept in the URL
  (`?loc=`) and localStorage. Switching it never changes the instance's
  *active* location (the collector's and MCP tools' default), which is only set
  by the setup card, by adding the first location, or explicitly through the
  API / `add_location` with `select: true`.
- **Collections are serialised.** "↻ Collect now", the built-in scheduler, the
  CLI and the MCP `collect_now` tool take a lock file next to `history.json`, so
  two overlapping runs can no longer drop each other's snapshot.

### Several people, one instance (behind a trusted proxy)

If a reverse proxy in front of the app authenticates users and can forward the
signed-in identity in a header, set **`WEATHER_IDENTITY_HEADER`** to that
header's name (the platform deploy uses `X-Forwarded-User`, set by Caddy's
`forward_auth` + `copy_headers`). The app then keeps one small file per person
under `users/` next to `settings.json` (`WEATHER_USERS_DIR` to move it):

- Everyone sees **only the locations they follow** and has their own active one.
  The pool of locations, the collector, the history and the PurpleAir key stay
  shared, so a place two people both track is collected once.
- **Add** follows a pool entry at the same spot with the same sensor if one
  exists, else creates one. **Rename** applies in place. **Moving** a location
  (coordinates or sensor) that someone else also follows gives you your own
  copy and leaves theirs alone. **Remove** unfollows, and retires the pool entry
  only when nobody is left following it.
- A person with no file follows nothing and gets the setup card. Turning the
  header on for an instance that already has locations? Seed the existing
  people first so their dashboards stay populated:
  `node scripts/seed-users.mjs alice@example.com bob@example.com`.
- A request without the header is refused (401): once you trust the header, a
  request that skipped the proxy must not fall back to the shared view. The
  proxy must strip any client-supplied copy of the header before setting it.

The MCP tools are unaffected: they never see an identity (only the gateway's
per-call nonce) and keep picking the tracked location nearest the caller's
profile home, else the instance's active one.

Two things to decide: **where it runs** (which determines storage) and **how you
reach it** (which determines auth).

### Authentication (optional)

Set **`SITE_PASSWORD`** to put the whole app behind a password (HTTP Basic Auth).
It's a no-op when unset, so:

- **Private access** (Tailscale, Cloudflare Access, LAN) — leave it unset. The
  network already authenticates you; a password would just be friction.
- **Public URL** (a PaaS deploy, a Tailscale Funnel, an open port) — **set it.**
  Single-tenant doesn't mean private: without a password, anyone who reaches the
  URL can rewrite your keys and locations through the POST endpoints. The username
  is ignored; only the password matters. (`COLLECT_TOKEN` separately guards
  `/api/collect` for cron callers.)

### Option 1: Docker (self-host: a Pi, NAS, home server, or any small VPS)

Keeps the JSON storage as-is (no database), bundles the scheduler, and runs the
dashboard and collection in one container:

```bash
docker compose up -d --build      # dashboard + scheduled collection
# open http://localhost:3002, then add locations / PurpleAir key in the UI
```

Data persists in the `weather-data` volume (`history.json`, `settings.json`,
`forecasts.json` under `/data`). Edit `docker-compose.yml` to set
`COLLECT_INTERVAL_MINUTES`, `SITE_PASSWORD`, or seed a starting location.

#### A free public URL (self-host from your own computer)

You don't need a server or open ports — a **tunnel** runs an outbound connection
from your machine to a provider that gives you a public HTTPS address. Three free
options, in order of how I'd reach for them:

> ⚠️ **Set `SITE_PASSWORD` first.** A public URL is reachable by anyone (and by
> bots, within minutes). Without a password, strangers can rewrite your keys and
> locations through the POST endpoints. Edit `docker-compose.yml` →
> `SITE_PASSWORD: "something-strong"` and `docker compose up -d` before exposing.

**1. Cloudflare quick tunnel — instant, zero setup (URL changes on restart).**
Built into the compose file as an opt-in sidecar. No account, no domain:

```bash
docker compose --profile tunnel up -d --build
docker compose logs cloudflared        # → https://<random-words>.trycloudflare.com
```

That URL is public immediately. The catch: it's **random and changes every
restart**, so it's best for a quick share or a test, not a permanent home.

**2. Tailscale Funnel — free *and* stable, no domain (recommended for permanent).**
Install Tailscale on the host, then point a stable public `*.ts.net` HTTPS URL at
the container (run *without* the tunnel profile — Funnel replaces cloudflared):

```bash
docker compose up -d --build           # app on localhost:3002
tailscale funnel 3002                  # → https://<machine>.<tailnet>.ts.net (stable)
```

Same Tailscale also gives you **private** access (just `tailscale up`, no Funnel) —
reach the dashboard from your own devices with no public URL and no password at
all. Funnel is the opt-in step that makes it public.

**3. Cloudflare named tunnel — stable + your own domain (needs a ~$10/yr domain).**
If you own a domain on Cloudflare, a named tunnel gives a permanent custom
hostname and can sit behind **Cloudflare Access** (Google/email login — then you
can skip `SITE_PASSWORD`). Create the tunnel in the Cloudflare dashboard, grab its
token, and swap the sidecar's command to
`tunnel --no-autoupdate run --token <YOUR_TOKEN>`.

| Option | Free | Stable URL | Domain needed | Best for |
|---|---|---|---|---|
| Cloudflare quick tunnel | ✅ | ❌ (random) | No | Instant share / testing |
| **Tailscale Funnel** | ✅ | ✅ | No | **Permanent free public URL** |
| Cloudflare named tunnel | ✅ | ✅ | Yes (~$10/yr) | Custom domain + SSO login |

### Option 2: One-click PaaS (no machine to own)

Same image, hosted for you, with a public HTTPS URL out of the box.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/YOUR_USERNAME/weather-patterns)

> Replace `YOUR_USERNAME` once the repo is published. The included `render.yaml`
> provisions a 1 GB persistent disk and prompts you for a `SITE_PASSWORD`.

**Cost note:** these need to stay awake (a sleeping service runs no collector) and
need a persistent disk, so the free tiers don't fit. Budget **~$5–7/month**:

- **Render** — free services sleep after 15 min and can't have a disk, so use the
  **Starter** plan (~$7/mo) with the 1 GB disk in `render.yaml`.
- **Railway** — no free tier; the **Hobby** plan is ~$5/mo. New Project → Deploy
  from this repo (it autodetects the Dockerfile) → add a **Volume** mounted at
  `/data` → set `SITE_PASSWORD`.

### Option 3: Vercel / serverless

Possible, but the filesystem is ephemeral, so you must swap the JSON store for a
hosted DB first — see [Privacy and data](#privacy-and-data) above. Highest effort
of the three; only worth it if you specifically want Vercel.

## How the numbers are made

### Today's forecast (high / low)

The **Today's forecast** section compares the daily high and low across the
forecast-capable sources (NWS and Open-Meteo — PurpleAir is a live sensor with no
forecast) and shows a **consensus** (the average) plus the spread between them. It's
fetched live each time you open or switch a location (not stored), via
`GET /api/forecast?loc=<id>`. Forecasters live in `lib/forecast.mjs` as a registry,
so more fields (precip, wind…) or sources slot in the same way sources do.

### Forecast accuracy (1-day-ahead)

The **Forecast accuracy** section measures which source forecasts best over time:

- Every collection logs each source's **1-day-ahead** forecast (today's forecast for
  *tomorrow*) to `forecasts.json` (`lib/forecastdb.mjs`), upserted per
  `(location, source, target_date)`. Once that day passes, the row is a frozen
  prediction made the day before — a fair forecast, not hindsight.
- When a day completes, each forecast is scored two ways (`lib/accuracy.mjs`):
  **vs its own observed high/low** (NWS from our logged readings, Open-Meteo from its
  archive API) and **vs your PurpleAir sensor's** observed high/low. The reported
  numbers are **MAE** (average miss) and **bias** (average signed error; + = ran warm).
- The **station gap** (own observation − PurpleAir) separates forecast-model error
  from station-representativeness: if a source's forecast matches its own station but
  both differ from PurpleAir, the station just isn't where you are.

It **accumulates over time** — a real score needs a day that's *over* and whose
forecast was logged the day before, so keep the collector running. Until then, the
section shows a **"today so far"** provisional view (today's forecast vs the high/low
observed so far) for immediate feedback. Observed daily high/low is reconstructed from
the collected snapshots, so a denser collection cadence gives truer extremes. Served
live via `GET /api/accuracy?loc=<id>` (it also returns a per-day `daily` series).

Once a day is scored, two charts (`app/AccuracyCharts.tsx`) appear. Left: **forecast
vs actual** — observations are **solid** lines (the white actual high/low from your
PurpleAir sensor or the consensus, plus each source's own observation), and each
source's **forecast** is a **dashed** line in the same colour with an error bar to
actual. So you read real temperatures (e.g. 90°) and see three gaps: forecast→white (vs
your local truth), forecast→its-own-solid (its model error), and own-solid→white (its
station's siting difference). Right: a **scatter of error vs the day's actual** — an
upward slope means a source forecasts worse on hotter days. A Daily-high/low toggle
switches both, and per-source toggles hide/show each source (the white actual line
stays) so you can isolate one source's error.

Integrity details: "tomorrow" is derived from the location's UTC offset (not a date
array, which can lag near local midnight), so a same-day forecast can't overwrite a
real 1-day-ahead one; and the scorer only counts a forecast if it was issued **before
the target day's local noon** — i.e. before the afternoon high could be observed. That
forgives a forecast logged a few minutes past local midnight while still excluding a
genuine same-day-afternoon "forecast" that already peeked at the high.

### Are the sources even in the same place?

NWS and Open-Meteo follow the location's coordinates, but a PurpleAir **sensor** lives
wherever it physically is — which can be a different town. The dashboard shows each
source's real location and its distance from the location in the **Location** row, and
pops a banner when a source is more than ~15 mi away, since cross-area readings aren't
comparable. Pick a closer sensor for that location under **📍 Locations**, or treat the
gap as a deliberate cross-area comparison.

### How divergence / "which to favor" works

- **Spread** (current table): max − min across sources for each metric right now,
  color-flagged green/amber/red.
- **Outlier leaderboard**: each snapshot, for each metric reported by 3+ sources,
  the source furthest from the group **median** gets a point. Over time this shows
  who is most often the odd one out.
- **Important caveat:** outlier ≠ wrong. Without ground truth we can only measure
  *disagreement*, not *accuracy*. Your **PurpleAir** sensor is the only truly-local
  measurement, so it's the closest thing to ground truth for your exact spot —
  treat large, persistent gaps from it as the interesting signal.

## For developers

### Capability grants

Weather Patterns is a capability on the shared local vault. Its manifest
([`capability.json`](capability.json)) declares the two optional connections it
may use (`purpleair:default`, `open_meteo:default`, both `read`). Saving a key —
in the dashboard or via `connect_provider` — stores the secret and registers a
grant (`weather:purpleair:default`); removing the key revokes both. Fetchers
read through `getSecretFor("weather", ...)`. The default `VAULT_GRANT_MODE=auto`
never blocks locally; `VAULT_GRANT_MODE=explicit` enforces the grant rows and a
present-but-ungranted key fails with a `grant_missing` error telling you to
reconnect. The full contract for building such capabilities is the vault repo's
[CAPABILITY.md](https://github.com/toothbrush-inc/toy-box-vault/blob/main/CAPABILITY.md).

The manifest's `store` block carries the name, tagline, description and
highlights the store page shows for this app, and the path (`/weather`) its web
UI is mounted at under the store domain. The gateway reads it as the default;
its own config can override any field.

### Under the gateway

The [capability gateway](https://github.com/toothbrush-inc/toy-box-gateway) mounts
this server behind one MCP endpoint with explicit grants, tool policy, an audit
log and a brokered egress path. One entry in `gateway.config.json`:

```json
{
  "id": "weather",
  "command": "node",
  "args": ["mcp/server.mjs"],
  "cwd": "/path/to/weather-patterns",
  "manifestPath": "/path/to/weather-patterns/capability.json",
  "secretsAccess": "broker"
}
```

The three run modes from the contract all work:

| Mode | Trigger | Secret access |
|---|---|---|
| Standalone | no egress env | `getSecretFor` in-process; keys attached locally per the manifest |
| Brokered | `VAULT_EGRESS_URL` / `VAULT_EGRESS_TOKEN` present | credentialed fetches go through the broker; no key in-process |
| Broker-only | + `VAULT_SECRETS_ACCESS=broker` | fetch-path vault reads throw; the broker is the only path |

`lib/provider-http.mjs` is the one choke point that picks the mode for every
credentialed request. The platform injects every `VAULT_*` variable; never ask a
user to set one by hand.

### Project layout

```
weather-patterns/
├─ app/
│  ├─ page.tsx            # dashboard (client): switcher, table, Locations & Keys panels
│  ├─ HistoryCharts.tsx   # Recharts line charts per metric
│  ├─ layout.tsx · globals.css
│  └─ api/
│     ├─ collect/route.ts   # POST/GET → fetch all sources for every location, store
│     ├─ data/route.ts      # GET ?loc= → payload for one location
│     ├─ locations/route.ts # GET/POST → add/update/remove/select locations
│     ├─ geocode/route.ts   # GET ?q= → city/address search (OSM Nominatim, no key)
│     ├─ stations/route.ts  # GET ?lat=&lon= → live per-source station distances
│     ├─ forecast/route.ts  # GET ?loc= → live daily high/low + consensus
│     ├─ accuracy/route.ts  # GET ?loc= → 1-day-ahead forecast accuracy leaderboard
│     └─ settings/route.ts  # GET/POST → PurpleAir + optional Open-Meteo keys (masked)
├─ mcp/
│  ├─ server.mjs          # stdio MCP server (Cursor / Claude Desktop)
│  ├─ tools.mjs           # typed JSON handlers over lib/*
│  └─ privacy.mjs         # strip API keys from tool results
├─ lib/
│  ├─ sources.mjs         # current-conditions fetchers + unit normalization
│  ├─ forecast.mjs        # daily-forecast fetchers (per-date) + consensus
│  ├─ forecastdb.mjs      # 1-day-ahead forecast log (forecasts.json)
│  ├─ accuracy.mjs        # score logged forecasts vs own obs + PurpleAir
│  ├─ http.mjs            # shared getJSON (UA + error wrapping)
│  ├─ db.mjs              # JSON history store, partitioned by loc_id
│  ├─ payload.mjs         # latest-per-source + outlier analysis, per location
│  ├─ settings.mjs        # settings.json store + location CRUD
│  ├─ vault.mjs           # shared local vault (API keys, not locations)
│  ├─ config.mjs          # effective config (locations) + seeding
│  ├─ aqi.mjs · geo.mjs · constants.mjs
├─ scripts/collect.mjs    # standalone collector for cron/launchd (all locations)
└─ .env.local.example
```

### Adding a source

1. Add a fetcher to `lib/sources.mjs` returning the normalized metric shape and
   register it in `FETCHERS`.
2. Add a label/color in `lib/constants.mjs` and enable logic in `lib/config.mjs`.

That's it — storage, charts, and the leaderboard pick it up automatically.

## Development

```bash
npm run dev          # dashboard at http://localhost:3002
npm run mcp          # stdio MCP server
npm run collect      # one collection snapshot for every location
npm test             # vitest
npm run lint
```

## License

[MIT](LICENSE).
