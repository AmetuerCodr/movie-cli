import { describe, test, expect, afterEach } from "bun:test";
import { rm } from "node:fs/promises";
import { readConfig, writeConfig, configPath } from "../src/utils/config.ts";

const CONFIG = configPath();

afterEach(async () => {
  await rm(CONFIG, { force: true });
});

describe("configPath", () => {
  test("returns a string ending in config.json", () => {
    expect(configPath()).toMatch(/config\.json$/);
  });

  test("path is absolute", () => {
    expect(configPath().startsWith("/")).toBe(true);
  });
});

describe("readConfig", () => {
  test("returns empty object when file is missing", async () => {
    await rm(CONFIG, { force: true });
    const config = await readConfig();
    expect(config).toEqual({});
  });

  test("returns parsed JSON when file exists", async () => {
    await writeConfig({ player: "mpv", quality: "1080p" });
    const config = await readConfig();
    expect(config.player).toBe("mpv");
    expect(config.quality).toBe("1080p");
  });
});

describe("writeConfig", () => {
  test("persists a key-value pair", async () => {
    await writeConfig({ provider: "cineby" });
    const config = await readConfig();
    expect(config.provider).toBe("cineby");
  });

  test("merges patch with existing values", async () => {
    await writeConfig({ player: "vlc" });
    await writeConfig({ quality: "720p" });
    const config = await readConfig();
    expect(config.player).toBe("vlc");
    expect(config.quality).toBe("720p");
  });

  test("overwrites only the patched keys", async () => {
    await writeConfig({ player: "mpv", quality: "1080p" });
    await writeConfig({ quality: "720p" });
    const config = await readConfig();
    expect(config.player).toBe("mpv");
    expect(config.quality).toBe("720p");
  });
});
