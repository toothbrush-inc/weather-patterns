// Browser loopback connect for API-key providers. Same contract as calsync
// connect_provider: return { url, expires_at }, never take the secret as a
// tool argument. Completes in the background into the shared vault.

import { execFile } from "node:child_process";

import { ApiKeyLoopback } from "@dvd-toy-box/vault";

import {
  KEYLESS_PROVIDERS,
  VAULT_SLOT,
  putProviderGrant,
  putProviderSecret,
  weatherConnectionId,
} from "../lib/vault.mjs";

export const CONNECT_PAGES = {
  purpleair: {
    title: "Connect PurpleAir",
    heading: "PurpleAir READ key",
    message:
      "Paste your PurpleAir READ key. It is stored in the local vault and never appears in chat.",
    fieldLabel: "READ key",
    helpUrl: "https://develop.purpleair.com",
    helpLabel: "Get a free READ key",
    successText: "PurpleAir key saved to the local vault. You can close this window.",
  },
  open_meteo: {
    title: "Connect Open-Meteo",
    heading: "Open-Meteo (no key needed)",
    message:
      "The public Open-Meteo API works without a key — just authorize it below. " +
      "Paste a customer key only if you have a paid plan.",
    fieldLabel: "Customer API key (optional)",
    helpUrl: "https://open-meteo.com/en/pricing",
    helpLabel: "Open-Meteo pricing / customer API",
    successText: "Open-Meteo authorized. You can close this window.",
    allowEmpty: true,
    emptyLabel: "Authorize without a key",
  },
};

const pending = new Map();

export function isVaultProvider(provider) {
  return Object.hasOwn(CONNECT_PAGES, provider);
}

export async function startConnect(provider, options = {}) {
  if (!isVaultProvider(provider)) {
    throw new Error(`unknown provider: ${provider}. Use purpleair or open_meteo.`);
  }
  const base = process.env.WEATHER_CONNECT_BASE_URL?.trim();
  if (base) {
    // Hosted mode shares one fixed port behind the reverse proxy — only one
    // connect session can exist at a time, regardless of provider.
    for (const pendingProvider of [...pending.keys()]) cancelConnect(pendingProvider);
  } else {
    cancelConnect(provider);
  }
  const loopback = await ApiKeyLoopback.start({
    page: CONNECT_PAGES[provider],
    ...(base
      ? {
          path: `/connect/${provider}`,
          host: process.env.WEATHER_CONNECT_BIND_HOST || "0.0.0.0",
          port: Number(process.env.WEATHER_CONNECT_PORT || 8811),
          publicBaseUrl: base,
        }
      : {}),
  });
  const session = {
    provider,
    url: loopback.url,
    expiresAt: loopback.expiresAt,
    cancel: () => loopback.close(),
    complete: async () => {
      try {
        const secret = await loopback.waitForSecret();
        if (secret === "" && KEYLESS_PROVIDERS.has(provider)) {
          // Keyless authorize: grant egress without storing any credential.
          putProviderGrant(provider);
        } else {
          // One write path: putProviderSecret stores the secret, registers the
          // capability grant, and clears any legacy settings.json copy.
          await putProviderSecret(provider, secret);
        }
      } finally {
        loopback.close();
      }
    },
  };
  pending.set(provider, session);
  try {
    await presentConnectUrl(session.url, options);
  } catch (error) {
    session.cancel();
    pending.delete(provider);
    throw error;
  }
  void session.complete().then(
    () => {
      if (pending.get(provider) === session) pending.delete(provider);
    },
    (error) => {
      if (pending.get(provider) === session) pending.delete(provider);
      const message = error instanceof Error ? error.message : "connect failed";
      process.stderr.write(`weather-patterns mcp: connect_provider ${weatherConnectionId(provider)} failed: ${message}\n`);
    },
  );
  return {
    provider,
    slot: VAULT_SLOT,
    url: session.url,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export function cancelConnect(provider) {
  const session = pending.get(provider);
  if (session) {
    session.cancel();
    pending.delete(provider);
  }
}

async function presentConnectUrl(url, options) {
  options.onAuthorizationUrl?.(url);
  if (options.openBrowser === false) return;
  try {
    await openSystemBrowser(url);
  } catch (error) {
    if (options.onBrowserOpenFailure === undefined) throw error;
    options.onBrowserOpenFailure(url, error);
  }
}

function openSystemBrowser(url) {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  return new Promise((resolve, reject) => {
    execFile(opener, [url], (error) => {
      if (error === null) resolve();
      else reject(new Error(error.message, { cause: error }));
    });
  });
}
