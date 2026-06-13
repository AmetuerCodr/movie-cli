import { describe, test, expect } from "bun:test";
import { listProviders, getProvider, providerChain } from "../src/scraper/index.ts";

describe("listProviders", () => {
  test("returns a non-empty array", () => {
    expect(listProviders().length).toBeGreaterThan(0);
  });

  test("includes 'cineby' and 'vidsrc'", () => {
    const names = listProviders();
    expect(names).toContain("cineby");
    expect(names).toContain("vidsrc");
  });

  test("each entry is a string", () => {
    listProviders().forEach((n) => expect(typeof n).toBe("string"));
  });
});

describe("getProvider", () => {
  test("returns null for unknown name", () => {
    expect(getProvider("does-not-exist")).toBeNull();
  });

  test("returns provider object for 'cineby'", () => {
    const p = getProvider("cineby");
    expect(p).not.toBeNull();
    expect(p?.name).toBe("cineby");
  });

  test("returns provider object for 'vidsrc'", () => {
    const p = getProvider("vidsrc");
    expect(p).not.toBeNull();
    expect(p?.name).toBe("vidsrc");
  });

  test("returned provider has search and getStreams methods", () => {
    const p = getProvider("cineby");
    expect(typeof p?.search).toBe("function");
    expect(typeof p?.getStreams).toBe("function");
  });
});

describe("providerChain", () => {
  test("puts the preferred provider first", () => {
    const chain = providerChain("vidsrc");
    expect(chain[0]?.name).toBe("vidsrc");
  });

  test("includes all registered providers", () => {
    const chain = providerChain("cineby");
    const names = chain.map((p) => p.name);
    expect(names).toContain("cineby");
    expect(names).toContain("vidsrc");
  });

  test("returns full chain when unknown preferred given", () => {
    const chain = providerChain("unknown-xyz");
    expect(chain.length).toBe(listProviders().length);
  });

  test("each item has name, search, getStreams", () => {
    providerChain("cineby").forEach((p) => {
      expect(typeof p.name).toBe("string");
      expect(typeof p.search).toBe("function");
      expect(typeof p.getStreams).toBe("function");
    });
  });
});
