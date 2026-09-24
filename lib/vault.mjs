// Shared local vault (`@dvd-toy-box/vault`). Secrets live in Keychain /
// local-vault home, not in this repo's cwd. Fetchers resolve keys here first,
// then settings.json / env as a legacy fallback.

import { readFileSync } from "node:fs";

import {
  connectionId,
  GrantError,
  grantFromManifest,
  openVault,
  parseCapabilityManifest,
} from "@dvd-toy-box/vault";

import { CREDENTIAL_PROVIDERS, getCredentialViews, getSettings, setCredential } from "./settings.mjs";

// Parsed at module load so a malformed manifest fails fast, not at first use.
const rawManifest = JSON.parse(readFileSync(new URL("../capability.json", import.meta.url), "utf8"));
export const WEATHER_MANIFEST = parseCapabilityManifest(rawManifest);
// The app's own words (the manifest's `store` block), read raw so they are
// available whichever @dvd-toy-box/vault version parsed the rest. The store page,
// the gateway's status and this server's instructions all say these.
export const WEATHER_STORE = rawManifest.store ?? { name: "Weather Patterns" };

export const VAULT_SLOT = "default";
export const VAULT_PROVIDERS = WEATHER_MANIFEST.connections.map((need) => need.provider);
// Providers whose public API needs no credential: the grant alone authorizes
// brokered egress; a stored key only unlocks the paid/customer tier.
export const KEYLESS_PROVIDERS = new Set(["open_meteo"]);

let instance;

export function weatherVault() {
  instance ??= openVault();
  return instance;
}

export function resetWeatherVault() {
  instance = undefined;
}

export function weatherConnectionId(provider) {
  return connectionId(provider, VAULT_SLOT);
}

function legacyProviderSecret(provider) {
  const spec = CREDENTIAL_PROVIDERS[provider];
  if (!spec) return "";
  const saved = getSettings()[spec.settingsKey]?.[spec.field];
  if (saved) return String(saved);
  return process.env[spec.env] || "";
}

export async function getProviderSecret(provider) {
  const fromVault = await weatherVault().getSecret(weatherConnectionId(provider));
  if (fromVault) return fromVault;
  return legacyProviderSecret(provider);
}

// Presence check that never touches the secret on a fetch path — safe under
// VAULT_SECRETS_ACCESS=broker, where getSecretFor throws.
export async function hasProviderSecret(provider) {
  const view = await weatherVault().status(weatherConnectionId(provider));
  if (view.set) return true;
  return Boolean(legacyProviderSecret(provider));
}

// Fetch paths read through the grant check. A vault secret without a grant
// fails actionably; a missing secret still falls back to settings/env like
// the plain not-connected case.
export async function getProviderSecretFor(provider, action = "read") {
  const id = weatherConnectionId(provider);
  const view = await weatherVault().status(id);
  if (!view.set) return legacyProviderSecret(provider);
  try {
    return await weatherVault().getSecretFor(WEATHER_MANIFEST.id, id, action);
  } catch (error) {
    if (error instanceof GrantError) {
      const actionable = new Error(
        `weather is not granted ${id}; reconnect it: call connect_provider with provider=${provider}`,
        { cause: error },
      );
      actionable.code = "grant_missing";
      throw actionable;
    }
    throw error;
  }
}

/** Keyless providers: authorize egress without storing any credential. */
export function putProviderGrant(provider) {
  weatherVault().putGrant(grantFromManifest(WEATHER_MANIFEST, provider, VAULT_SLOT));
}

export async function putProviderSecret(provider, apiKey) {
  const spec = CREDENTIAL_PROVIDERS[provider];
  if (!spec) throw new Error(`unknown credential provider: ${provider}`);
  const secret = String(apiKey ?? "").trim();
  if (!secret) {
    await weatherVault().revoke(weatherConnectionId(provider));
  } else {
    await weatherVault().putSecret({
      provider,
      slot: VAULT_SLOT,
      kind: "apikey",
      secret,
    });
    weatherVault().putGrant(grantFromManifest(WEATHER_MANIFEST, provider, VAULT_SLOT));
  }
  // Stop keeping a second copy in settings.json once the vault has the write.
  setCredential(provider, "");
  const views = await getKeyStatusViews();
  return views[provider];
}

export async function getKeyStatusViews() {
  const legacy = getCredentialViews();
  const vault = weatherVault();
  const out = {};
  for (const provider of VAULT_PROVIDERS) {
    const view = await vault.status(weatherConnectionId(provider));
    if (view.set) {
      out[provider] = {
        set: true,
        origin: "vault",
        masked: view.masked,
        status: view.status,
        kind: view.kind,
      };
      continue;
    }
    const fallback = legacy[provider] || { set: false, masked: "", origin: "none" };
    out[provider] = {
      set: fallback.set,
      origin: fallback.origin,
      masked: fallback.masked,
      status: fallback.set ? "ok" : "missing",
      kind: "apikey",
    };
  }
  return out;
}
