import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { logger } from "./logger.js";

export interface Config {
  player?: string;
  provider?: string;
  quality?: string;
  tmdbApiKey?: string;
}

const CONFIG_DIR = join(homedir(), ".config", "mov-cli");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export function configPath(): string {
  return CONFIG_PATH;
}

export async function readConfig(): Promise<Config> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as Config;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      logger.debug("Failed to read config, using defaults:", err);
    }
    return {};
  }
}

export async function writeConfig(patch: Partial<Config>): Promise<void> {
  const current = await readConfig();
  const next: Config = { ...current, ...patch };
  try {
    await mkdir(dirname(CONFIG_PATH), { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify(next, null, 2), "utf8");
    logger.debug("Wrote config to", CONFIG_PATH);
  } catch (err) {
    logger.debug("Failed to write config:", err);
  }
}
