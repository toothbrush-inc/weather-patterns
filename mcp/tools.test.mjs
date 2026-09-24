import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openVault } from "@dvd-toy-box/vault";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWeatherMcpServer } from "./server.mjs";
import {
  handleCompareSources,
  handleConnectProvider,
  handleFindPurpleairSensors,
  handleGetCurrent,
  handleGetStatus,
  handleQueryHistory,
  handleRequestCapability,
  handleUpdateLocation,
  toJsonPayload,
} from "./tools.mjs";
import { sanitizeToolPayload } from "./privacy.mjs";
import { addLocation } from "../lib/settings.mjs";
import { putProviderSecret, resetWeatherVault } from "../lib/vault.mjs";
import { cancelConnect } from "./connect.mjs";

let dir;
// Seeded readings are an hour old, whatever today is: query_history caps its
// window at 30 days, so a fixed date would age out of the test.
const SEED_TS = new Date(Date.now() - 3600_000).toISOString();

function seed({ key = "super-secret-purpleair-key", history = true } = {}) {
  writeFileSync(
    process.env.WEATHER_SETTINGS,
    JSON.stringify({
      locations: [
        {
          id: "home",
          name: "Test Home",
          lat: 37.89,
          lon: -122.12,
          purpleair_sensor_index: "12345",
        },
      ],
      activeLocationId: "home",
      purpleair: { read_key: key },
    }),
  );
  if (history) {
    writeFileSync(
      process.env.WEATHER_DB,
      JSON.stringify([
        {
          ts: SEED_TS,
          loc_id: "home",
          source: "nws",
          temp_f: 72,
          humidity: 50,
          wind_mph: 5,
          pressure_inhg: 29.9,
          pm25: null,
          aqi: null,
          conditions: "Sunny",
          status: "ok",
        },
        {
          ts: SEED_TS,
          loc_id: "home",
          source: "open_meteo",
          temp_f: 74,
          humidity: 48,
          wind_mph: 6,
          pressure_inhg: 29.92,
          pm25: 8,
          aqi: 33,
          conditions: "Clear",
          status: "ok",
        },
        {
          ts: SEED_TS,
          loc_id: "home",
          source: "purpleair",
          temp_f: 76,
          humidity: 44,
          pm25: 10,
          aqi: 41,
          status: "ok",
        },
      ]),
    );
  } else {
    writeFileSync(process.env.WEATHER_DB, "[]");
  }
  writeFileSync(process.env.WEATHER_FORECASTS, "[]");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "weather-mcp-"));
  process.env.WEATHER_SETTINGS = join(dir, "settings.json");
  process.env.WEATHER_DB = join(dir, "history.json");
  process.env.WEATHER_FORECASTS = join(dir, "forecasts.json");
  process.env.WEATHER_GAPS = join(dir, "gaps.json");
  process.env.VAULT_HOME = join(dir, "vault");
  process.env.VAULT_SECRETS_BACKEND = "file";
  delete process.env.PURPLEAIR_READ_KEY;
  delete process.env.OPEN_METEO_API_KEY;
  delete process.env.VAULT_GRANT_MODE;
  resetWeatherVault();
  seed();
});

afterEach(() => {
  cancelConnect("purpleair");
  cancelConnect("open_meteo");
  delete process.env.VAULT_GRANT_MODE;
  resetWeatherVault();
  rmSync(dir, { recursive: true, force: true });
});

describe("MCP privacy", () => {
  it("strips API keys and token-like strings", () => {
    const json = JSON.stringify(
      sanitizeToolPayload({
        temp_f: 72,
        read_key: "super-secret-purpleair-key",
        api_key: "om-secret",
        note: "PURPLEAIR_READ_KEY=leak",
      }),
    );
    expect(json).toContain("72");
    expect(json).not.toContain("super-secret");
    expect(json).not.toContain("om-secret");
    expect(json).toContain("[redacted]");
  });
});

describe("MCP tool handlers", () => {
  it("get_status lists locations and reports masked key_status", async () => {
    const result = await handleGetStatus();
    expect(result.ok).toBe(true);
    const json = JSON.stringify(toJsonPayload(result.data));
    expect(result.data.locations[0]).toMatchObject({ id: "home", name: "Test Home" });
    expect(result.data.key_status.purpleair.set).toBe(true);
    expect(result.data.key_status.purpleair.origin).toBe("saved");
    expect(result.data.key_status.purpleair.masked).toMatch(/••••/);
    expect(result.data).not.toHaveProperty("credentials");
    expect(json).not.toContain("super-secret-purpleair-key");
    expect(json).not.toContain("read_key");
  });

  it("connect_provider returns a loopback URL and never takes a key", async () => {
    const result = await handleConnectProvider({ provider: "open_meteo", open_browser: false });
    expect(result.ok).toBe(true);
    expect(result.data.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
    expect(result.data.provider).toBe("open_meteo");
    expect(result.data).not.toHaveProperty("api_key");
    expect(JSON.stringify(toJsonPayload(result.data))).not.toContain("customer-meteo-secret");

    const posted = await fetch(result.data.url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        state: new URL(result.data.url).searchParams.get("state"),
        api_key: "customer-meteo-secret",
      }),
    });
    expect(posted.ok).toBe(true);
    expect(await posted.text()).not.toContain("customer-meteo-secret");

    await vi.waitFor(async () => {
      const status = await handleGetStatus();
      expect(status.data.key_status.open_meteo.origin).toBe("vault");
      expect(status.data.key_status.open_meteo.set).toBe(true);
    });
    const encoded = JSON.stringify(toJsonPayload((await handleGetStatus()).data));
    expect(encoded).not.toContain("customer-meteo-secret");
    const saved = JSON.parse(readFileSync(process.env.WEATHER_SETTINGS, "utf8"));
    expect(JSON.stringify(saved)).not.toContain("customer-meteo-secret");
    expect(saved.open_meteo?.api_key).toBeFalsy();
  });

  it("connect_provider advertises the public URL in hosted mode", async () => {
    process.env.WEATHER_CONNECT_BASE_URL = "https://gw.example.com";
    process.env.WEATHER_CONNECT_BIND_HOST = "127.0.0.1";
    process.env.WEATHER_CONNECT_PORT = "0";
    try {
      const result = await handleConnectProvider({ provider: "purpleair", open_browser: false });
      expect(result.ok).toBe(true);
      expect(result.data.url).toMatch(/^https:\/\/gw\.example\.com\/connect\/purpleair\?state=/);
    } finally {
      delete process.env.WEATHER_CONNECT_BASE_URL;
      delete process.env.WEATHER_CONNECT_BIND_HOST;
      delete process.env.WEATHER_CONNECT_PORT;
      cancelConnect("purpleair");
    }
  });

  it("get_status reports vault origin and enables PurpleAir after a vault write", async () => {
    await putProviderSecret("purpleair", "vault-purpleair-key");
    const result = await handleGetStatus();
    expect(result.data.key_status.purpleair).toMatchObject({ set: true, origin: "vault" });
    expect(result.data.locations[0].sources_enabled).toContain("purpleair");
    expect(JSON.stringify(toJsonPayload(result.data))).not.toContain("vault-purpleair-key");
  });

  it("find_purpleair_sensors fails closed without a key", async () => {
    seed({ key: "" });
    const result = await handleFindPurpleairSensors({ location_id: "home" });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("missing_key");
  });

  it("find_purpleair_sensors reports grant_missing for an ungranted key in explicit mode", async () => {
    seed({ key: "" });
    await openVault({ home: process.env.VAULT_HOME, backend: "file" }).putSecret({
      provider: "purpleair",
      slot: "default",
      kind: "apikey",
      secret: "vault-purpleair-key",
    });
    process.env.VAULT_GRANT_MODE = "explicit";
    resetWeatherVault();

    const result = await handleFindPurpleairSensors({ location_id: "home" });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("grant_missing");
    expect(result.error.message).toContain("connect_provider with provider=purpleair");
  });

  it("update_location attaches a PurpleAir sensor index", () => {
    const result = handleUpdateLocation({ id: "home", purpleair_sensor_index: "62489" });
    expect(result.ok).toBe(true);
    expect(result.data.location.purpleair_sensor_index).toBe("62489");
  });

  it("query_history, get_current, and compare_sources return trimmed collected readings", async () => {
    const current = await handleGetCurrent({ location_id: "home" });
    expect(current.ok).toBe(true);
    expect(current.data.latest.nws.temp_f).toBe(72);
    expect(current.data.latest.nws).not.toHaveProperty("loc_id");

    const compared = await handleCompareSources({ location_id: "home" });
    expect(compared.ok).toBe(true);
    expect(compared.data.spreads.temp_f).toMatchObject({ min: 72, max: 76 });

    const history = await handleQueryHistory({ location_id: "home", hours: 24 * 365 });
    expect(history.ok).toBe(true);
    expect(history.data.points.length).toBeGreaterThan(0);
    expect(history.data.points[0]).not.toHaveProperty("loc_lat");
  });

  it("request_capability records a sanitized gap", () => {
    const result = handleRequestCapability({
      intent: "hourly precip radar",
      context: "user asked for a rain map",
    });
    expect(result.ok).toBe(true);
    expect(result.data.recorded).toBe(true);
    expect(result.data.intent).toBe("hourly precip radar");
  });

  it("addLocation via settings is what add_location writes", async () => {
    const loc = addLocation({ name: "Work", lat: 37.8, lon: -122.4 });
    const status = await handleGetStatus();
    expect(status.data.locations.some((l) => l.id === loc.id)).toBe(true);
  });
});

describe("MCP stdio server", () => {
  it("registers typed tools over the official SDK in-memory transport", async () => {
    const server = createWeatherMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "weather-test", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name)).toEqual([
        "get_status",
        "search_places",
        "add_location",
        "update_location",
        "remove_location",
        "connect_provider",
        "find_purpleair_sensors",
        "get_current",
        "get_forecast",
        "query_history",
        "compare_sources",
        "forecast_accuracy",
        "collect_now",
        "request_capability",
      ]);
      const status = await client.callTool({ name: "get_status", arguments: {} });
      expect("isError" in status && status.isError === true).toBe(false);
      const encoded = JSON.stringify(status);
      expect(encoded).toContain("Test Home");
      expect(encoded).not.toContain("super-secret-purpleair-key");
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("caller-scoped default location", () => {
  function seedTwoLocations() {
    writeFileSync(
      process.env.WEATHER_SETTINGS,
      JSON.stringify({
        locations: [
          { id: "home", name: "Lafayette", lat: 37.89, lon: -122.12 },
          { id: "away", name: "Berlin", lat: 52.52, lon: 13.405 },
        ],
        activeLocationId: "home",
      }),
    );
  }

  function seedProfile(fields) {
    const vault = openVault({ home: process.env.VAULT_HOME, backend: "file" });
    vault.putProfile(fields);
    vault.putGrant({
      capability: "weather",
      connectionId: "profile:default",
      actions: ["home_lat", "home_lon"],
    });
  }

  it("defaults to the tracked location nearest the caller's profile home", async () => {
    seedTwoLocations();
    seedProfile({ home_lat: "52.50", home_lon: "13.40" });
    const status = await handleGetStatus();
    expect(status.ok).toBe(true);
    expect(status.data.caller.default_location_id).toBe("away");
    // The shared list and the shared active choice are untouched.
    expect(status.data.activeLocationId).toBe("home");
    expect(status.data.locations.map((l) => l.id).sort()).toEqual(["away", "home"]);
  });

  it("falls back to the shared active location when the profile has no home", async () => {
    seedTwoLocations();
    seedProfile({ locale: "en-GB" });
    const status = await handleGetStatus();
    expect(status.data.caller.default_location_id).toBe("home");
  });

  it("works with no profile at all, and says so", async () => {
    seedTwoLocations();
    const status = await handleGetStatus();
    expect(status.data.caller.default_location_id).toBe("home");
    expect(status.data.caller.profile_source).toBe("default");
    // Readings stay labelled, so nothing needs a per-user unit preference.
    expect(status.data.caller).not.toHaveProperty("units");
  });

  it("still honours an explicit location argument", async () => {
    seedTwoLocations();
    seedProfile({ home_lat: "52.50", home_lon: "13.40" });
    const history = await handleQueryHistory({ location_id: "home", hours: 24 });
    expect(history.ok).toBe(true);
  });
});
