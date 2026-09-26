import { afterEach, describe, expect, it, vi } from "vitest";

import { getJSON, withOpenMeteoKey, withTimeout } from "./http.mjs";

describe("withOpenMeteoKey", () => {
  const publicUrl =
    "https://api.open-meteo.com/v1/forecast?latitude=37.89&longitude=-122.12";

  it("leaves the public URL alone when no key is set", () => {
    expect(withOpenMeteoKey(publicUrl, "")).toBe(publicUrl);
    expect(withOpenMeteoKey(publicUrl)).toBe(publicUrl);
  });

  it("moves customer traffic off the public host and never mutates the original URL", () => {
    const keyed = withOpenMeteoKey(publicUrl, "customer-meteo-secret");
    const u = new URL(keyed);
    expect(u.host).toBe("customer-api.open-meteo.com");
    expect(u.searchParams.get("apikey")).toBe("customer-meteo-secret");
    expect(publicUrl).not.toContain("apikey");
    expect(publicUrl).toContain("api.open-meteo.com");
  });
});

// A fetch that accepts the request and never answers, honouring the abort signal
// the way the real fetch does.
function hangingFetch(_url, init = {}) {
  return new Promise((_, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal.reason));
  });
}

describe("getJSON timeouts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("gives up on a server that never answers", async () => {
    vi.stubGlobal("fetch", hangingFetch);
    await expect(getJSON("https://api.weather.gov/points/1,2", {}, { timeoutMs: 50 })).rejects.toMatchObject({
      code: "timeout",
      message: "timed out after 0.05s for api.weather.gov",
    });
  });

  it("gives up on a body that stalls after the headers arrive", async () => {
    vi.stubGlobal("fetch", async (_url, init = {}) => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"partial":'));
          init.signal?.addEventListener("abort", () => controller.error(init.signal.reason));
        },
      });
      return new Response(body, { status: 200 });
    });
    await expect(getJSON("https://api.open-meteo.com/v1/forecast", {}, { timeoutMs: 50 })).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("passes ordinary failures through unchanged", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 503 }));
    await expect(getJSON("https://api.weather.gov/x", {}, { timeoutMs: 50 })).rejects.toThrow(
      "HTTP 503 for api.weather.gov: nope",
    );
  });
});

describe("withTimeout", () => {
  it("rejects when the promise outlives the limit", async () => {
    await expect(withTimeout(new Promise(() => {}), "https://example.com/a", 20)).rejects.toMatchObject({
      code: "timeout",
      message: "timed out after 0.02s for example.com",
    });
  });

  it("returns the value when the promise settles first", async () => {
    await expect(withTimeout(Promise.resolve(7), "https://example.com/a", 1000)).resolves.toBe(7);
  });
});
