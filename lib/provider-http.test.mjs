import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { providerGetJSON } from "./provider-http.mjs";
import { hasProviderSecret, putProviderSecret, resetWeatherVault } from "./vault.mjs";

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "weather-egress-"));
  process.env.WEATHER_SETTINGS = join(dir, "settings.json");
  process.env.VAULT_HOME = join(dir, "vault");
  process.env.VAULT_SECRETS_BACKEND = "file";
  delete process.env.PURPLEAIR_READ_KEY;
  delete process.env.OPEN_METEO_API_KEY;
  delete process.env.VAULT_EGRESS_URL;
  delete process.env.VAULT_EGRESS_TOKEN;
  delete process.env.VAULT_SECRETS_ACCESS;
  resetWeatherVault();
  writeFileSync(process.env.WEATHER_SETTINGS, JSON.stringify({ locations: [] }));
});

afterEach(() => {
  delete process.env.VAULT_EGRESS_URL;
  delete process.env.VAULT_EGRESS_TOKEN;
  delete process.env.VAULT_SECRETS_ACCESS;
  resetWeatherVault();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

function brokerReply(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("providerGetJSON brokered mode", () => {
  it("sends one POST to the broker with the public URL and never the key", async () => {
    await putProviderSecret("purpleair", "should-never-be-sent");
    process.env.VAULT_EGRESS_URL = "http://127.0.0.1:9999";
    process.env.VAULT_EGRESS_TOKEN = "egress-token";

    const calls = [];
    vi.stubGlobal("fetch", async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return brokerReply({
        ok: true,
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sensor: { name: "Hamlin" } }),
      });
    });

    const data = await providerGetJSON("purpleair", "https://api.purpleair.com/v1/sensors/1");
    expect(data).toEqual({ sensor: { name: "Hamlin" } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:9999/fetch");
    expect(calls[0].init.headers.Authorization).toBe("Bearer egress-token");
    const body = JSON.parse(calls[0].init.body);
    expect(body).toMatchObject({
      provider: "purpleair",
      slot: "default",
      url: "https://api.purpleair.com/v1/sensors/1",
    });
    expect(JSON.stringify(calls)).not.toContain("should-never-be-sent");
  });

  it("shapes upstream failures like getJSON and rewraps grant_missing actionably", async () => {
    process.env.VAULT_EGRESS_URL = "http://127.0.0.1:9999";
    process.env.VAULT_EGRESS_TOKEN = "egress-token";

    vi.stubGlobal("fetch", async () =>
      brokerReply({ ok: true, status: 402, contentType: "text/plain", body: "quota exceeded" }),
    );
    await expect(
      providerGetJSON("open_meteo", "https://api.open-meteo.com/v1/forecast?latitude=1"),
    ).rejects.toThrow(/HTTP 402 for api\.open-meteo\.com: quota exceeded/);

    vi.stubGlobal("fetch", async () =>
      brokerReply({ ok: false, error: { code: "grant_missing", message: "no grant" } }, 403),
    );
    const rejection = await providerGetJSON(
      "purpleair",
      "https://api.purpleair.com/v1/sensors/1",
    ).then(
      () => null,
      (error) => error,
    );
    expect(rejection.code).toBe("grant_missing");
    expect(rejection.message).toContain("connect_provider with provider=purpleair");

    // Keyless provider: the repair is the GRANT, never the key form.
    const keyless = await providerGetJSON(
      "open_meteo",
      "https://api.open-meteo.com/v1/forecast?latitude=1",
    ).then(
      () => null,
      (error) => error,
    );
    expect(keyless.code).toBe("grant_missing");
    expect(keyless.message).toContain("NO key");
    expect(keyless.message).toContain("gateway_grant capability=weather connection=open_meteo:default");
  });
});

describe("broker-only secrets mode", () => {
  it("fails loudly when a fetch path would bypass the broker", async () => {
    await putProviderSecret("purpleair", "vault-key");
    process.env.VAULT_SECRETS_ACCESS = "broker";
    resetWeatherVault();
    await expect(
      providerGetJSON("purpleair", "https://api.purpleair.com/v1/sensors/1"),
    ).rejects.toThrow(/broker-only/);
  });

  it("works through the broker without reading the vault secret", async () => {
    await putProviderSecret("purpleair", "vault-key");
    process.env.VAULT_SECRETS_ACCESS = "broker";
    process.env.VAULT_EGRESS_URL = "http://127.0.0.1:9999";
    process.env.VAULT_EGRESS_TOKEN = "tok";
    resetWeatherVault();
    vi.stubGlobal("fetch", async () =>
      brokerReply({ ok: true, status: 200, contentType: "application/json", body: '{"fine":true}' }),
    );
    await expect(
      providerGetJSON("purpleair", "https://api.purpleair.com/v1/sensors/1"),
    ).resolves.toEqual({ fine: true });
  });

  it("keeps presence checks working under broker mode", async () => {
    await putProviderSecret("purpleair", "vault-key");
    process.env.VAULT_SECRETS_ACCESS = "broker";
    resetWeatherVault();
    await expect(hasProviderSecret("purpleair")).resolves.toBe(true);
    await expect(hasProviderSecret("open_meteo")).resolves.toBe(false);
  });
});
