#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { cli, type CliOptions } from "./cli.js";
import { browserManager } from "./browser/index.js";
import { VERSION } from "./ui/colors.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .scriptName("mov-cli")
    .usage("$0 [options]\n\nWatch movies from your terminal — ani-cli for movies.")
    .option("player", {
      alias: "p",
      type: "string",
      describe: "Force a specific player (mpv, vlc, cvlc, iina)",
    })
    .option("provider", {
      alias: "P",
      type: "string",
      default: "cineby",
      describe: "Scraping provider to use",
    })
    .option("quality", {
      alias: "q",
      type: "string",
      default: "best",
      describe: "Preferred quality (best, 1080p, 720p, 480p)",
    })
    .option("headless", {
      type: "boolean",
      default: true,
      describe: "Run the scraping browser headless (use --no-headless to debug)",
    })
    .option("debug", {
      alias: "d",
      type: "boolean",
      default: false,
      describe: "Enable verbose debug logging",
    })
    .option("list-players", {
      type: "boolean",
      default: false,
      describe: "Print detected players and exit",
    })
    .option("list-providers", {
      type: "boolean",
      default: false,
      describe: "Print available providers and exit",
    })
    .version("version", "Print version and exit", VERSION)
    .alias("version", "v")
    .alias("help", "h")
    .strict()
    .wrap(Math.min(100, process.stdout.columns ?? 100))
    .parseAsync();

  if (argv.debug) {
    process.env.MOV_CLI_DEBUG = "1";
  }

  const opts: CliOptions = {
    provider: argv.provider as string,
    quality: argv.quality as string,
    headless: argv.headless as boolean,
    debug: argv.debug as boolean,
    listPlayers: argv["list-players"] as boolean,
    listProviders: argv["list-providers"] as boolean,
  };
  if (argv.player) opts.player = argv.player as string;

  await cli(opts);
}

let shuttingDown = false;
async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  // Restore the cursor in case a prompt/spinner hid it.
  if (process.stderr.isTTY) process.stderr.write("[?25h");
  await browserManager.close().catch(() => {});
  process.exit(code);
}

process.on("SIGINT", () => {
  console.log("\n" + "Bye! 👋");
  void shutdown(0);
});

process.on("uncaughtException", (err) => {
  logger.error("Unexpected error:", err instanceof Error ? err.message : String(err));
  logger.debug(err);
  void shutdown(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unexpected error:", reason instanceof Error ? reason.message : String(reason));
  logger.debug(reason);
  void shutdown(1);
});

main()
  .then(() => shutdown(0))
  .catch((err) => {
    logger.error(err instanceof Error ? err.message : String(err));
    logger.debug(err);
    void shutdown(1);
  });
