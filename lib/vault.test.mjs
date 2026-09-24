import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openVault } from "@dvd-toy-box/vault";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getConfig } from "./config.mjs";
import {
  getKeyStatusViews,
  getProviderSecret,
  getProviderSecretFor,
  putProviderSecret,
  resetWeatherVault,
  weatherVault,
} from "./vault.mjs";

let dir;

function seedSettings(extra = {}) {
  writeFileSync(
    process.env.WEATHER_SETTINGS,
    JSON.stringify({
      locations: [{ id: "home", name: "Home", lat: 37.89, lon: -122.12 }],
      activeLocationId: "home",
      ...extra,
    }),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "weather-vault-"));
  process.env.WEATHER_SETTINGS = join(dir, "settings.json");
  process.env.VAULT_HOME = join(dir, "vault");
  process.env.VAULT_SECRETS_BACKEND = "file";
  delete process.env.PURPLEAIR_READ_KEY;
  delete process.env.OPEN_METEO_API_KEY;
  delete process.env.VAULT_GRANT_MODE;
  resetWeatherVault();
  seedSettings();
});

afterEach(() => {
  delete process.env.VAULT_GRANT_MODE;
  resetWeatherVault();
  rmSync(dir, { recursive: true, force: true });
});

describe("getProviderSecret", () => {
  it("falls back to leftover settings.json, then env", async () => {
    expect(await getProviderSecret("purpleair")).toBe("");

    seedSettings({ purpleair: { read_key: "legacy-settings-key" } });
    expect(await getProviderSecret("purpleair")).toBe("legacy-settings-key");

    seedSettings();
    process.env.PURPLEAIR_READ_KEY = "env-purpleair-key";
    expect(await getProviderSecret("purpleair")).toBe("env-purpleair-key");
  });

  it("prefers the vault over leftover settings.json and env", async () => {
    seedSettings({ purpleair: { read_key: "legacy-settings-key" } });
    process.env.PURPLEAIR_READ_KEY = "env-purpleair-key";
    await putProviderSecret("purpleair", "vault-purpleair-key");
    expect(await getProviderSecret("purpleair")).toBe("vault-purpleair-key");
  });

  it("returns empty for an unknown provider", async () => {
    expect(await getProviderSecret("not-a-provider")).toBe("");
  });
});

describe("putProviderSecret", () => {
  it("writes the vault and clears the settings.json copy", async () => {
    seedSettings({ purpleair: { read_key: "legacy-settings-key" } });
    const view = await putProviderSecret("purpleair", "vault-purpleair-key");
    expect(view).toMatchObject({ set: true, origin: "vault", status: "ok" });
    expect(view.masked).toMatch(/••••/);
    expect(JSON.stringify(view)).not.toContain("vault-purpleair-key");

    const saved = JSON.parse(readFileSync(process.env.WEATHER_SETTINGS, "utf8"));
    expect(saved.purpleair?.read_key).toBeFalsy();
    expect(await getProviderSecret("purpleair")).toBe("vault-purpleair-key");
  });

  it("revokes an empty write", async () => {
    await putProviderSecret("open_meteo", "customer-meteo-secret");
    await putProviderSecret("open_meteo", "  ");
    expect(await getProviderSecret("open_meteo")).toBe("");
    expect((await getKeyStatusViews()).open_meteo).toMatchObject({
      set: false,
      origin: "none",
      status: "missing",
    });
  });

  it("rejects an unknown provider", async () => {
    await expect(putProviderSecret("google", "nope")).rejects.toThrow(/unknown credential provider/);
  });
});

describe("capability grants", () => {
  it("registers a weather grant on put and removes it on revoke", async () => {
    await putProviderSecret("purpleair", "vault-purpleair-key");
    expect(weatherVault().listGrants("weather")).toMatchObject([
      { id: "weather:purpleair:default", connectionId: "purpleair:default", actions: ["read"] },
    ]);

    await putProviderSecret("purpleair", "");
    expect(weatherVault().listGrants("weather")).toEqual([]);
  });

  it("enforces grants on fetch paths in explicit mode, keeping legacy fallback", async () => {
    process.env.VAULT_GRANT_MODE = "explicit";
    resetWeatherVault();

    // Missing secret is the plain not-connected case: env fallback, no throw.
    process.env.PURPLEAIR_READ_KEY = "env-purpleair-key";
    await expect(getProviderSecretFor("purpleair")).resolves.toBe("env-purpleair-key");
    delete process.env.PURPLEAIR_READ_KEY;

    // A vault secret without a grant fails actionably.
    await openVault({ home: process.env.VAULT_HOME, backend: "file" }).putSecret({
      provider: "purpleair",
      slot: "default",
      kind: "apikey",
      secret: "vault-purpleair-key",
    });
    const rejection = await getProviderSecretFor("purpleair").then(
      () => null,
      (error) => error,
    );
    expect(rejection).toBeInstanceOf(Error);
    expect(rejection.code).toBe("grant_missing");
    expect(rejection.message).toContain("connect_provider with provider=purpleair");

    // putProviderSecret writes the secret and the grant in one path.
    await putProviderSecret("purpleair", "vault-purpleair-key");
    await expect(getProviderSecretFor("purpleair")).resolves.toBe("vault-purpleair-key");
  });
});

describe("getKeyStatusViews", () => {
  it("reports origin vault, saved, env, or none — never the secret", async () => {
    let views = await getKeyStatusViews();
    expect(views.purpleair).toMatchObject({ set: false, origin: "none", status: "missing" });
    expect(views.open_meteo.origin).toBe("none");

    seedSettings({ purpleair: { read_key: "legacy-settings-key" } });
    views = await getKeyStatusViews();
    expect(views.purpleair).toMatchObject({ set: true, origin: "saved" });
    expect(JSON.stringify(views)).not.toContain("legacy-settings-key");

    seedSettings();
    process.env.OPEN_METEO_API_KEY = "env-om-key";
    views = await getKeyStatusViews();
    expect(views.open_meteo).toMatchObject({ set: true, origin: "env" });
    expect(JSON.stringify(views)).not.toContain("env-om-key");

    await putProviderSecret("purpleair", "vault-purpleair-key");
    views = await getKeyStatusViews();
    expect(views.purpleair.origin).toBe("vault");
    expect(JSON.stringify(views)).not.toContain("vault-purpleair-key");
  });
});

describe("getConfig", () => {
  it("does not thread API keys onto the config object", () => {
    seedSettings({
      purpleair: { read_key: "legacy-settings-key" },
      open_meteo: { api_key: "legacy-om-key" },
    });
    const cfg = getConfig();
    expect(cfg).not.toHaveProperty("sources");
    expect(JSON.stringify(cfg)).not.toContain("legacy-settings-key");
    expect(JSON.stringify(cfg)).not.toContain("legacy-om-key");
  });
});
