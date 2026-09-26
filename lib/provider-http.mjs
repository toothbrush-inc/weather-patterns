// Single egress choke point for credentialed providers. When the gateway
// hands this process an egress endpoint (VAULT_EGRESS_URL/TOKEN), requests go
// through the broker and this process never touches the key. Standalone, the
// key is read from the vault and attached locally, driven by the same
// manifest egress spec the broker uses. Callers always pass PUBLIC urls;
// keyed/customer hosts are an attachment-time detail on either path.

import { brokeredGet, egressFromEnv } from "@dvd-toy-box/vault";

import { getJSON, UA, withTimeout } from "./http.mjs";
import { getProviderSecretFor, KEYLESS_PROVIDERS, VAULT_SLOT, WEATHER_MANIFEST } from "./vault.mjs";

function egressSpecFor(provider) {
  const need = WEATHER_MANIFEST.connections.find(
    (connection) => connection.provider === provider && connection.slot === VAULT_SLOT,
  );
  return need?.egress;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export async function providerGetJSON(provider, url, headers = {}) {
  const egress = egressFromEnv(process.env);
  if (egress) {
    let reply;
    try {
      // brokeredGet takes no signal, so bound it from outside (see withTimeout).
      reply = await withTimeout(
        brokeredGet(egress, {
          provider,
          slot: VAULT_SLOT,
          url,
          headers: { "User-Agent": UA, ...headers },
        }),
        url,
      );
    } catch (error) {
      if (error?.code === "grant_missing") {
        // The repair differs by provider kind: keyless providers need only the
        // grant (their public API takes no key); keyed ones need the connect flow.
        const actionable = new Error(
          KEYLESS_PROVIDERS.has(provider)
            ? `weather is not granted ${provider}:${VAULT_SLOT}. ${provider}'s public API needs NO key — ` +
              `just grant the connection (gateway_grant capability=weather connection=${provider}:${VAULT_SLOT}), ` +
              `or run connect_provider with provider=${provider} and choose "Authorize without a key". ` +
              `A key is only for the paid customer tier.`
            : `weather is not granted ${provider}:${VAULT_SLOT}; reconnect it: call connect_provider with provider=${provider}`,
          { cause: error },
        );
        actionable.code = "grant_missing";
        throw actionable;
      }
      throw error;
    }
    if (reply.status < 200 || reply.status >= 300) {
      const body = reply.body ? `: ${reply.body.slice(0, 160)}` : "";
      throw new Error(`HTTP ${reply.status} for ${hostOf(url)}${body}`);
    }
    return JSON.parse(reply.body);
  }

  // Standalone: in-process key read, manifest-driven attachment.
  const spec = egressSpecFor(provider);
  const key = await getProviderSecretFor(provider);
  if (!key || !spec) return getJSON(url, headers);
  if (spec.attach.kind === "header") {
    return getJSON(url, { ...headers, [spec.attach.name]: key });
  }
  const keyed = new URL(url);
  const rewritten = spec.hostRewrite?.[keyed.hostname];
  if (rewritten) keyed.hostname = rewritten;
  keyed.searchParams.set(spec.attach.name, key);
  return getJSON(keyed.toString(), headers);
}
