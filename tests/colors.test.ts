import { describe, test, expect } from "bun:test";
import { banner, c, VERSION } from "../src/ui/colors.ts";

describe("VERSION", () => {
  test("is a non-empty semver-like string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
    expect(VERSION).toMatch(/^\d+\.\d+/);
  });
});

describe("banner", () => {
  test("returns a non-empty string", () => {
    const b = banner();
    expect(typeof b).toBe("string");
    expect(b.length).toBeGreaterThan(0);
  });

  test("contains the version number", () => {
    expect(banner()).toContain(VERSION);
  });

  test("contains the help hint", () => {
    expect(banner()).toContain("--help");
  });
});

describe("color helpers", () => {
  test("each helper returns a string", () => {
    expect(typeof c.title("x")).toBe("string");
    expect(typeof c.year("x")).toBe("string");
    expect(typeof c.rating("x")).toBe("string");
    expect(typeof c.type("x")).toBe("string");
    expect(typeof c.dim("x")).toBe("string");
    expect(typeof c.accent("x")).toBe("string");
    expect(typeof c.ok("x")).toBe("string");
  });

  test("each helper embeds the input text", () => {
    const samples = ["The Matrix", "(1999)", "★ 8.7", "Movie", "quiet", "▶", "done"];
    const helpers = [c.title, c.year, c.rating, c.type, c.dim, c.accent, c.ok];
    helpers.forEach((fn, i) => {
      expect(fn(samples[i]!)).toContain(samples[i]);
    });
  });
});
