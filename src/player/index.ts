import spawn from "cross-spawn";
import type { ChildProcess } from "node:child_process";
import { which } from "../utils/which.js";
import { readConfig, writeConfig } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import type { PlayerConfig, Stream } from "./types.js";
import { mpvPlayer } from "./mpv.js";
import { cvlcPlayer, iinaPlayer, vlcPlayer } from "./vlc.js";

const ALL_PLAYERS: PlayerConfig[] = [mpvPlayer, iinaPlayer, vlcPlayer, cvlcPlayer];

// Detection order. IINA only makes sense on macOS.
const DETECTION_ORDER: PlayerConfig[] =
  process.platform === "darwin"
    ? [mpvPlayer, iinaPlayer, vlcPlayer, cvlcPlayer]
    : [mpvPlayer, vlcPlayer, cvlcPlayer];

export function knownPlayers(): PlayerConfig[] {
  return ALL_PLAYERS;
}

/** Return the configs for every player currently installed on PATH. */
export function detectInstalledPlayers(): PlayerConfig[] {
  return ALL_PLAYERS.filter((p) => which(p.bin) !== null);
}

/**
 * Resolve which player to use. Honors `preferred`, then a cached choice, then
 * falls back to the detection order. Throws if nothing is installed.
 */
export async function detectPlayer(preferred?: string): Promise<PlayerConfig> {
  if (preferred) {
    const match = ALL_PLAYERS.find((p) => p.name === preferred);
    if (!match) {
      throw new PlayerError(
        `Unknown player "${preferred}". Choose one of: ${ALL_PLAYERS.map((p) => p.name).join(", ")}`,
      );
    }
    if (!which(match.bin)) {
      throw new PlayerError(installHint(match.name));
    }
    return match;
  }

  const config = await readConfig();
  if (config.player) {
    const cached = ALL_PLAYERS.find((p) => p.name === config.player);
    if (cached && which(cached.bin)) {
      logger.debug("Using cached player:", cached.name);
      return cached;
    }
  }

  for (const player of DETECTION_ORDER) {
    if (which(player.bin)) {
      await writeConfig({ player: player.name });
      return player;
    }
  }

  throw new PlayerError(installHint());
}

/**
 * Spawn the player and resolve when it exits. Inherits stdio so the player can
 * own the terminal where appropriate.
 */
export function playStream(player: PlayerConfig, stream: Stream, title: string): Promise<number> {
  const args = player.buildArgs(stream, title);
  logger.debug("Spawning:", player.bin, args.join(" "));

  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(player.bin, args, { stdio: "ignore" });
    } catch (err) {
      reject(err);
      return;
    }
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

export class PlayerError extends Error {}

function installHint(name?: string): string {
  if (name === "vlc" || name === "cvlc") {
    return [
      "VLC was not found on your PATH.",
      "  macOS:   brew install --cask vlc",
      "  Linux:   sudo apt install vlc   (or your distro's package manager)",
      "  Windows: winget install VideoLAN.VLC",
    ].join("\n");
  }
  if (name === "iina") {
    return "IINA was not found. Install it from https://iina.io (macOS only).";
  }
  return [
    "No supported media player found (looked for mpv, vlc, cvlc, iina).",
    "Install mpv (recommended):",
    "  macOS:   brew install mpv",
    "  Linux:   sudo apt install mpv   (or your distro's package manager)",
    "  Windows: winget install mpv     (or scoop install mpv)",
  ].join("\n");
}
