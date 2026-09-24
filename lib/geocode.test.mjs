import { afterEach, describe, expect, it, vi } from "vitest";

import { reverseGeocode, searchPlaces } from "./geocode.mjs";

function jsonOk(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchPlaces", () => {
  it("returns an empty list for short queries without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await searchPlaces("L")).toEqual({
      results: [],
      attribution: "© OpenStreetMap contributors",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps Nominatim hits to concise name + coords", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonOk([
        {
          lat: "37.8858",
          lon: "-122.1180",
          name: "Lafayette",
          address: { city: "Lafayette", state: "California", country_code: "us" },
        },
      ]),
    );
    const { results } = await searchPlaces("Lafayette CA");
    expect(results).toEqual([{ name: "Lafayette, California, US", lat: 37.8858, lon: -122.118 }]);
  });
});

describe("reverseGeocode", () => {
  it("names a point from Nominatim reverse", async () => {
    vi.stubGlobal("fetch", async (url) => {
      expect(String(url)).toContain("nominatim.openstreetmap.org/reverse");
      expect(String(url)).toContain("lat=37.8788");
      return jsonOk({
        lat: "37.8788",
        lon: "-122.1177",
        address: {
          house_number: "3484",
          road: "South Silver Springs Road",
          city: "Lafayette",
          state: "California",
          country_code: "us",
        },
      });
    });
    const { result } = await reverseGeocode(37.8788, -122.1177);
    expect(result).toEqual({
      name: "3484 South Silver Springs Road, Lafayette, California, US",
      lat: 37.8788,
      lon: -122.1177,
    });
  });

  it("returns null for non-numeric coords without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await reverseGeocode("x", "y")).toEqual({
      result: null,
      attribution: "© OpenStreetMap contributors",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
