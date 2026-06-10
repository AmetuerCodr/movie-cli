import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const isWindows = process.platform === "win32";

/**
 * Resolve the absolute path to an executable on the PATH, or null if not found.
 * Cross-platform: uses `where` on Windows and `which` elsewhere, falling back
 * to a manual PATH scan so it works even when those binaries are unavailable.
 */
export function which(bin: string): string | null {
  const lookup = isWindows ? "where" : "which";
  try {
    const result = spawnSync(lookup, [bin], { encoding: "utf8" });
    if (result.status === 0 && result.stdout) {
      const first = result.stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
      if (first) return first.trim();
    }
  } catch {
    // fall through to manual scan
  }

  return manualScan(bin);
}

function manualScan(bin: string): string | null {
  const pathEnv = process.env.PATH ?? "";
  const exts = isWindows
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];

  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, bin + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}
