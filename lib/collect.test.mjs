import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { withCollectionLock } from "./collect.mjs";

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "weather-lock-"));
  process.env.WEATHER_DB = join(dir, "history.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.WEATHER_DB;
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("withCollectionLock", () => {
  it("runs overlapping collections one after another", async () => {
    const log = [];
    const job = (name) => async () => {
      log.push(`${name}:start`);
      await sleep(40);
      log.push(`${name}:end`);
      return name;
    };
    const results = await Promise.all([withCollectionLock(job("a")), withCollectionLock(job("b"))]);
    expect(results).toEqual(["a", "b"]);
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end"]);
    expect(existsSync(`${process.env.WEATHER_DB}.lock`)).toBe(false);
  });

  it("releases the lock when the collection throws", async () => {
    await expect(withCollectionLock(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(existsSync(`${process.env.WEATHER_DB}.lock`)).toBe(false);
    await expect(withCollectionLock(async () => "ok")).resolves.toBe("ok");
  });

  it("takes over a stale lock left by a crashed collector", async () => {
    const lock = `${process.env.WEATHER_DB}.lock`;
    writeFileSync(lock, "dead 2020-01-01T00:00:00Z\n");
    const old = new Date(Date.now() - 10 * 60_000);
    utimesSync(lock, old, old);
    await expect(withCollectionLock(async () => "took over")).resolves.toBe("took over");
    expect(existsSync(lock)).toBe(false);
  });
});
