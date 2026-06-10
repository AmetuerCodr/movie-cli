import { browserManager } from "./browser/index.js";
import {
  getStreamsWithFallback,
  listProviders,
  searchWithFallback,
} from "./scraper/index.js";
import {
  detectInstalledPlayers,
  detectPlayer,
  knownPlayers,
  playStream,
  PlayerError,
} from "./player/index.js";
import type { PlayerConfig } from "./player/types.js";
import { banner, c } from "./ui/colors.js";
import { withSpinner } from "./ui/spinner.js";
import {
  promptContinue,
  promptQuality,
  promptRetry,
  promptSearch,
  promptSelectResult,
} from "./ui/prompt.js";
import { logger } from "./utils/logger.js";
import { writeConfig } from "./utils/config.js";
import type { Stream } from "./scraper/types.js";

export interface CliOptions {
  player?: string;
  provider: string;
  quality: string;
  headless: boolean;
  debug: boolean;
  listPlayers: boolean;
  listProviders: boolean;
}

export async function cli(opts: CliOptions): Promise<void> {
  if (opts.listPlayers) {
    printPlayers();
    return;
  }
  if (opts.listProviders) {
    printProviders();
    return;
  }

  console.log(banner());

  // Resolve the player up front so we fail fast with a friendly message.
  const player = await detectPlayer(opts.player).catch((err: unknown) => {
    if (err instanceof PlayerError) {
      console.error(`\n${c.dim(err.message)}\n`);
      process.exit(1);
    }
    throw err;
  });
  logger.debug("Using player:", player.name);

  // Persist non-default preferences for next time.
  await writeConfig({ provider: opts.provider, quality: opts.quality });

  await withSpinner("Starting browser…", () => browserManager.init(opts.headless), {
    fail: "Failed to start browser",
  });

  try {
    await interactiveLoop(opts, player);
  } finally {
    await browserManager.close();
  }
}

async function interactiveLoop(opts: CliOptions, player: PlayerConfig): Promise<void> {
  let running = true;
  while (running) {
    const query = await promptSearch();

    const found = await withSpinner(
      `Searching for ${c.title(query)}…`,
      () => searchWithFallback(opts.provider, query),
      { fail: "Search failed" },
    );

    if (!found || found.results.length === 0) {
      console.log(c.dim("\nNo results found."));
      if (await promptRetry("Try another search?")) continue;
      return;
    }

    logger.debug(`Found ${found.results.length} results via ${found.provider.name}`);

    const choice = await promptSelectResult(found.results);
    if (choice === "quit") return;
    if (choice === "back") continue;

    const streams = await withSpinner(
      "Fetching stream sources…",
      () => getStreamsWithFallback(opts.provider, choice),
      { fail: "Could not fetch streams" },
    );

    if (streams.length === 0) {
      console.log(c.dim("\nNo playable streams found for this title (all providers tried)."));
      if (await promptRetry("Search for something else?")) continue;
      return;
    }

    const stream = await selectStream(streams, opts.quality);
    const title = `${choice.title}${choice.year ? ` (${choice.year})` : ""}`;

    console.log(`\n${c.accent("▶")} Opening ${c.title(title)} in ${c.ok(player.name)}…`);
    console.log(c.dim("  (close the player window to return here)\n"));

    try {
      await playStream(player, stream, title);
    } catch (err) {
      logger.error("Player exited unexpectedly.");
      logger.debug(err);
    }

    const next = await promptContinue();
    running = next === "search";
  }
}

/**
 * Pick a stream honoring the requested quality, falling back to interactive
 * selection (or the best available) when there is no exact match.
 */
async function selectStream(streams: Stream[], preferred: string): Promise<Stream> {
  if (preferred !== "best") {
    const exact = streams.find((s) => s.quality === preferred);
    if (exact) return exact;
  }

  if (preferred === "best") {
    if (streams.length === 1) return streams[0] as Stream;
    return promptQuality(streams);
  }

  // Requested quality not available — let the user choose.
  logger.debug(`Quality ${preferred} not found; prompting.`);
  return promptQuality(streams);
}

function printPlayers(): void {
  const installed = new Set(detectInstalledPlayers().map((p) => p.name));
  console.log(c.title("\nSupported players:\n"));
  for (const player of knownPlayers()) {
    const status = installed.has(player.name)
      ? c.ok("installed")
      : c.dim("not found");
    console.log(`  ${player.name.padEnd(8)} ${status}`);
  }
  console.log();
}

function printProviders(): void {
  console.log(c.title("\nAvailable providers:\n"));
  const names = listProviders();
  names.forEach((name, i) => {
    const tag = i === 0 ? c.ok("(default)") : c.dim("(fallback)");
    console.log(`  ${name.padEnd(10)} ${tag}`);
  });
  console.log();
}
