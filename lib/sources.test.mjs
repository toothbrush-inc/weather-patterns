import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { enabledSourcesFor, FETCHERS, findNearbyPurpleAir } from "./sources.mjs";
import { putProviderSecret, resetWeatherVault } from "./vault.mjs";

const location = {
  id: "home",
  name: "Home",
  lat: 37.89,
  lon: -122.12,
  purpleair_sensor_index: "12345",
};

let dir;
let fetchCalls;

function jsonOk(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "weather-src-"));
  process.env.WEATHER_SETTINGS = join(dir, "settings.json");
  process.env.VAULT_HOME = join(dir, "vault");
  process.env.VAULT_SECRETS_BACKEND = "file";
  delete process.env.PURPLEAIR_READ_KEY;
  delete process.env.OPEN_METEO_API_KEY;
  resetWeatherVault();
  writeFileSync(
    process.env.WEATHER_SETTINGS,
    JSON.stringify({
      locations: [location],
      activeLocationId: "home",
      purpleair: { read_key: "legacy-settings-key" },
    }),
  );
  fetchCalls = [];
  vi.stubGlobal("fetch", async (url, init = {}) => {
    fetchCalls.push({ url: String(url), headers: init.headers || {} });
    throw new Error(`unexpected fetch: ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetWeatherVault();
  rmSync(dir, { recursive: true, force: true });
});

describe("enabledSourcesFor", () => {
  it("always includes NWS and Open-Meteo; PurpleAir needs a key and a sensor", async () => {
    expect(await enabledSourcesFor(location)).toEqual(["nws", "open_meteo", "purpleair"]);
    expect(await enabledSourcesFor({ ...location, purpleair_sensor_index: "" })).toEqual([
      "nws",
      "open_meteo",
    ]);

    writeFileSync(
      process.env.WEATHER_SETTINGS,
      JSON.stringify({ locations: [location], activeLocationId: "home" }),
    );
    expect(await enabledSourcesFor(location)).toEqual(["nws", "open_meteo"]);

    await putProviderSecret("purpleair", "vault-purpleair-key");
    expect(await enabledSourcesFor(location)).toEqual(["nws", "open_meteo", "purpleair"]);
  });
});

describe("FETCHERS.purpleair", () => {
  it("sends the vault key as X-API-Key, not the leftover settings.json value", async () => {
    await putProviderSecret("purpleair", "vault-purpleair-key");
    vi.stubGlobal("fetch", async (url, init = {}) => {
      fetchCalls.push({ url: String(url), headers: init.headers || {} });
      return jsonOk({
        sensor: {
          temperature: 80,
          humidity: 40,
          pressure: 1013.25,
          "pm2.5_atm": 10,
          latitude: 37.89,
          longitude: -122.12,
          name: "Patio",
        },
      });
    });

    const reading = await FETCHERS.purpleair(location);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain("/sensors/12345");
    expect(fetchCalls[0].headers["X-API-Key"]).toBe("vault-purpleair-key");
    expect(fetchCalls[0].headers["X-API-Key"]).not.toBe("legacy-settings-key");
    expect(reading).toMatchObject({
      temp_f: 72,
      humidity: 44,
      place: "Patio",
    });
    expect(JSON.stringify(reading)).not.toContain("vault-purpleair-key");
  });
});

describe("FETCHERS.open_meteo", () => {
  it("fetches the customer host with the vault key and keeps source_url public", async () => {
    await putProviderSecret("open_meteo", "customer-meteo-secret");
    vi.stubGlobal("fetch", async (url, init = {}) => {
      const href = String(url);
      fetchCalls.push({ url: href, headers: init.headers || {} });
      if (href.includes("air-quality")) {
        return jsonOk({ current: { pm2_5: 8, us_aqi: 33 } });
      }
      return jsonOk({
        latitude: 37.9,
        longitude: -122.1,
        current: {
          temperature_2m: 74.2,
          relative_humidity_2m: 48,
          wind_speed_10m: 6,
          surface_pressure: 1013.25,
          weather_code: 0,
        },
      });
    });

    const reading = await FETCHERS.open_meteo(location);
    const forecast = fetchCalls.find((c) => c.url.includes("/v1/forecast"));
    expect(forecast.url).toContain("customer-api.open-meteo.com");
    expect(forecast.url).toContain("apikey=customer-meteo-secret");
    expect(reading.source_url).toContain("api.open-meteo.com");
    expect(reading.source_url).not.toContain("apikey");
    expect(reading.source_url).not.toContain("customer-meteo-secret");
    expect(reading.temp_f).toBe(74.2);
    expect(reading.aqi).toBe(33);
  });
});

describe("findNearbyPurpleAir", () => {
  it("uses the vault when no key is passed", async () => {
    await putProviderSecret("purpleair", "vault-purpleair-key");
    vi.stubGlobal("fetch", async (url, init = {}) => {
      fetchCalls.push({ url: String(url), headers: init.headers || {} });
      return jsonOk({
        fields: ["sensor_index", "latitude", "longitude", "name", "confidence", "last_seen"],
        data: [[62489, 37.89, -122.12, "Near", 100, 1]],
      });
    });

    const found = await findNearbyPurpleAir({ lat: 37.89, lon: -122.12 });
    expect(fetchCalls[0].headers["X-API-Key"]).toBe("vault-purpleair-key");
    expect(found[0]).toMatchObject({ sensor_index: "62489", name: "Near" });
  });
});
