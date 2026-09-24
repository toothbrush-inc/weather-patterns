#!/usr/bin/env node
// Local stdio MCP server. Same pattern as calsync: official SDK, JSON tool
// results (content + structuredContent), secrets stripped, logs on stderr only.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withCallScope } from "@dvd-toy-box/vault/kit";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WEATHER_STORE } from "../lib/vault.mjs";

import {
  handleAddLocation,
  handleCollectNow,
  handleCompareSources,
  handleConnectProvider,
  handleFindPurpleairSensors,
  handleForecastAccuracy,
  handleGetCurrent,
  handleGetForecast,
  handleGetStatus,
  handleQueryHistory,
  handleRemoveLocation,
  handleRequestCapability,
  handleSearchPlaces,
  handleUpdateLocation,
  toJsonPayload,
} from "./tools.mjs";

const VERSION = "0.1.0";

const locationQuery = {
  location_id: z.string().optional().describe("Location id from get_status"),
  location_name: z.string().optional().describe("Substring match on a configured location name"),
};

export function createWeatherMcpServer() {
  // Scopes every tool below to whoever made the call, so profile reads resolve
  // that user. Standalone there is no caller and handlers run unwrapped.
  const server = withCallScope(new McpServer(
    { name: "weather-patterns", version: VERSION },
    {
      instructions:
        `${WEATHER_STORE.name}: ${WEATHER_STORE.tagline ?? "weather tools"} ` +
        "Tools over collected history and live forecasts. Results are typed JSON, never prose. API keys never appear in results. With no location argument, tools use the caller's own default — the tracked location nearest their profile home, else the active one. Use connect_provider to add a PurpleAir or Open-Meteo key (returns a URL; never pass API keys). Use get_forecast for 'what will the weather be like today?'. Use get_current for right now (from the ledger). Call request_capability when no tool can satisfy the ask.",
    },
  ));

  server.registerTool(
    "get_status",
    {
      description:
        "Configured locations, which sources are enabled, last snapshot time, and key_status (masked, origin vault/saved/env). JSON only; no API keys.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => jsonResult(await handleGetStatus()),
  );

  server.registerTool(
    "search_places",
    {
      description:
        "Geocode a city or street address to lat/lon candidates (OpenStreetMap Nominatim). Use before add_location when the user names a place.",
      inputSchema: z.object({
        query: z.string().describe("City or street address"),
        limit: z.number().int().min(1).max(12).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (input) => jsonResult(await handleSearchPlaces(input)),
  );

  server.registerTool(
    "add_location",
    {
      description:
        "Add a tracked location. Pass query (place name) or lat+lon. Optional purpleair_sensor_index, or nearest_purpleair=true to attach the closest outdoor sensor. If query is ambiguous, returns candidates and does not write.",
      inputSchema: z.object({
        query: z.string().optional().describe("Place name to geocode"),
        name: z.string().optional(),
        lat: z.number().optional(),
        lon: z.number().optional(),
        purpleair_sensor_index: z.string().optional(),
        nearest_purpleair: z.boolean().optional().describe("Attach nearest outdoor PurpleAir sensor"),
        select: z.boolean().optional().describe("Also make this the instance's shared active location (default false — it is everyone's default, not just this caller's)"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (input) => jsonResult(await handleAddLocation(input)),
  );

  server.registerTool(
    "update_location",
    {
      description:
        "Update a location: name, coordinates, or purpleair_sensor_index (the monitor id). Empty sensor index clears it.",
      inputSchema: z.object({
        id: z.string().describe("Location id"),
        name: z.string().optional(),
        lat: z.number().optional(),
        lon: z.number().optional(),
        purpleair_sensor_index: z.string().optional(),
        select: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (input) => jsonResult(handleUpdateLocation(input)),
  );

  server.registerTool(
    "remove_location",
    {
      description: "Remove a tracked location. History rows are kept.",
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    (input) => jsonResult(handleRemoveLocation(input)),
  );

  server.registerTool(
    "connect_provider",
    {
      description:
        "Start connecting a PurpleAir READ key or optional Open-Meteo customer key. Returns { url, expires_at } for a local browser form. Never pass API keys, tokens, or secrets. After the user finishes in the browser, call get_status.",
      inputSchema: z.object({
        provider: z.enum(["purpleair", "open_meteo"]).describe("purpleair (required for sensors) or open_meteo (optional commercial key)"),
        open_browser: z.boolean().optional().describe("Set false when this process cannot open a local browser; the returned url still works"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (input) => jsonResult(await handleConnectProvider(input)),
  );

  server.registerTool(
    "find_purpleair_sensors",
    {
      description:
        "List nearby outdoor PurpleAir sensors (needs a PurpleAir key). Pass a location_id or lat+lon. Returns sensor_index values to pass to update_location / add_location.",
      inputSchema: z.object({
        ...locationQuery,
        lat: z.number().optional(),
        lon: z.number().optional(),
        radius_mi: z.number().optional(),
        limit: z.number().int().min(1).max(10).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (input) => jsonResult(await handleFindPurpleairSensors(input)),
  );

  server.registerTool(
    "get_current",
    {
      description:
        "Latest collected observations per source for a location (from the history ledger, not a live fetch). Temp, humidity, wind, pressure, AQI, conditions, snapshot age.",
      inputSchema: z.object(locationQuery),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (input) => jsonResult(await handleGetCurrent(input)),
  );

  server.registerTool(
    "get_forecast",
    {
      description:
        "Daily forecast for a location: high/low °F, conditions, precip probability/inches, per source (NWS, Open-Meteo) plus consensus. Use this for 'what will the weather be like today?'. Defaults to today at the active location. days=1..7. " +
        "When a PurpleAir sensor has history, each source also carries sensor_relative: the forecast re-expressed against the local sensor via a rolling median offset (offset and n shown; raw numbers stay primary).",
      inputSchema: z.object({
        ...locationQuery,
        date: z.string().optional().describe("YYYY-MM-DD; default today at the location"),
        days: z.number().int().min(1).max(7).optional().describe("How many local days to return (default 1)"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (input) => jsonResult(await handleGetForecast(input)),
  );

  server.registerTool(
    "query_history",
    {
      description:
        "Collected snapshot history for a location over a trailing window (default 48 hours). Trimmed readings only — not the full ledger.",
      inputSchema: z.object({
        ...locationQuery,
        hours: z.number().optional().describe("Trailing window in hours (default 48, max 720)"),
        limit: z.number().int().optional().describe("Max snapshots to return (default 48, max 500)"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (input) => jsonResult(await handleQueryHistory(input)),
  );

  server.registerTool(
    "compare_sources",
    {
      description:
        "Side-by-side latest readings, per-metric spread (green/amber/red), and the outlier leaderboard — which source is most often furthest from the median.",
      inputSchema: z.object(locationQuery),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (input) => jsonResult(await handleCompareSources(input)),
  );

  server.registerTool(
    "forecast_accuracy",
    {
      description:
        "1-day-ahead forecast accuracy from the accumulated ledger: MAE and bias vs each source's own observations and vs PurpleAir, plus today's provisional score.",
      inputSchema: z.object({
        ...locationQuery,
        window_days: z.number().int().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (input) => jsonResult(await handleForecastAccuracy(input)),
  );

  server.registerTool(
    "collect_now",
    {
      description:
        "Take one collection snapshot now for every location (or one location_id) and log tomorrow's forecast. The collector otherwise runs on a schedule.",
      inputSchema: z.object({
        location_id: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (input) => jsonResult(await handleCollectNow(input)),
  );

  server.registerTool(
    "request_capability",
    {
      description:
        "Call this when no available tool or dataset can satisfy the user's ask. Pass a short sanitized intent summary (not the raw conversation). Records a gap for the backlog.",
      inputSchema: z.object({
        intent: z.string().describe("Short summary of the unsupported ask"),
        context: z.string().optional().describe("Optional extra detail, no secrets"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (input) => jsonResult(handleRequestCapability(input)),
  );

  return server;
}

export async function runMcpStdioServer(options = {}) {
  const server = createWeatherMcpServer();
  const transport = options.transport ?? new StdioServerTransport();
  process.stderr.write("weather-patterns mcp: listening on stdio\n");
  await server.connect(transport);
  try {
    await (options.closed ?? waitForStdioShutdown());
  } finally {
    await server.close();
  }
}

function waitForStdioShutdown() {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      process.stdin.off("end", done);
      process.stdin.off("close", done);
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      resolve();
    };
    process.stdin.once("end", done);
    process.stdin.once("close", done);
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

function jsonResult(result) {
  if (!result.ok) {
    process.stderr.write(`weather-patterns mcp: ${result.error.code}\n`);
    const payload = toJsonPayload({ error: result.error });
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  }
  const payload = toJsonPayload(result.data);
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  runMcpStdioServer().catch((err) => {
    process.stderr.write(`weather-patterns mcp: ${err?.stack || err}\n`);
    process.exit(1);
  });
}
