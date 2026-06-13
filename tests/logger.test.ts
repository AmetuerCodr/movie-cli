import { describe, test, expect, spyOn } from "bun:test";
import { logger } from "../src/utils/logger.ts";

describe("logger shape", () => {
  test("exposes expected methods", () => {
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  test("isDebug is a boolean", () => {
    expect(typeof logger.isDebug).toBe("boolean");
  });
});

describe("logger.info", () => {
  test("writes to stdout (console.log)", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    logger.info("hello");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("passes args through", () => {
    const calls: unknown[][] = [];
    const spy = spyOn(console, "log").mockImplementation((...a) => { calls.push(a); });
    logger.info("msg", 42);
    expect(calls.some((c) => c.includes("msg"))).toBe(true);
    spy.mockRestore();
  });
});

describe("logger.warn", () => {
  test("writes to stderr (console.warn)", () => {
    const spy = spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("careful");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("logger.error", () => {
  test("writes to stderr (console.error)", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    logger.error("boom");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("logger.debug", () => {
  test("only writes when MOV_CLI_DEBUG=1", () => {
    const calls: unknown[][] = [];
    const spy = spyOn(console, "error").mockImplementation((...a) => { calls.push(a); });
    logger.debug("trace info");
    if (!logger.isDebug) {
      expect(calls.some((c) => c.join("").includes("trace info"))).toBe(false);
    }
    spy.mockRestore();
  });
});
