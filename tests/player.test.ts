import { describe, test, expect } from "bun:test";
import { knownPlayers, detectInstalledPlayers, PlayerError } from "../src/player/index.ts";

describe("knownPlayers", () => {
  test("returns a non-empty array", () => {
    expect(knownPlayers().length).toBeGreaterThan(0);
  });

  test("each player has name, bin, buildArgs", () => {
    knownPlayers().forEach((p) => {
      expect(typeof p.name).toBe("string");
      expect(typeof p.bin).toBe("string");
      expect(typeof p.buildArgs).toBe("function");
    });
  });

  test("includes mpv and vlc", () => {
    const names = knownPlayers().map((p) => p.name);
    expect(names).toContain("mpv");
    expect(names).toContain("vlc");
  });
});

describe("detectInstalledPlayers", () => {
  test("returns an array (possibly empty)", () => {
    const players = detectInstalledPlayers();
    expect(Array.isArray(players)).toBe(true);
  });

  test("each detected player has a binary string", () => {
    detectInstalledPlayers().forEach((p) => {
      expect(typeof p.bin).toBe("string");
    });
  });
});

describe("PlayerError", () => {
  test("is an Error subclass", () => {
    const err = new PlayerError("not found");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof PlayerError).toBe(true);
    expect(err.message).toBe("not found");
  });
});

describe("player buildArgs", () => {
  const fakeStream = {
    url: "http://example.com/stream.m3u8",
    quality: "1080p",
    referer: "http://example.com",
    isM3U8: true,
  };

  test("mpv buildArgs returns an array of strings with the URL", () => {
    const mpv = knownPlayers().find((p) => p.name === "mpv");
    if (!mpv) return; // skip if mpv not in the list
    const args = mpv.buildArgs(fakeStream, "The Matrix");
    expect(Array.isArray(args)).toBe(true);
    expect(args.some((a) => a.includes("example.com"))).toBe(true);
  });

  test("vlc buildArgs returns an array of strings with the URL", () => {
    const vlc = knownPlayers().find((p) => p.name === "vlc");
    if (!vlc) return;
    const args = vlc.buildArgs(fakeStream, "The Matrix");
    expect(Array.isArray(args)).toBe(true);
    expect(args.some((a) => a.includes("example.com"))).toBe(true);
  });
});
