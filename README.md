# mov-cli

```
  ███╗   ███╗ ██████╗ ██╗   ██╗      ██████╗██╗     ██╗
  ████╗ ████║██╔═══██╗██║   ██║     ██╔════╝██║     ██║
  ██╔████╔██║██║   ██║██║   ██║     ██║     ██║     ██║
  ██║╚██╔╝██║██║   ██║╚██╗ ██╔╝     ██║     ██║     ██║
  ██║ ╚═╝ ██║╚██████╔╝ ╚████╔╝      ╚██████╗███████╗██║
  ╚═╝     ╚═╝ ╚═════╝   ╚═══╝        ╚═════╝╚══════╝╚═╝
```

**Watch movies from your terminal** — [ani-cli](https://github.com/pystardust/ani-cli) for movies.

`mov-cli` is a zero-install, cross-platform CLI written in TypeScript on the Bun
runtime. Search for a movie, pick a result, choose a quality, and it opens the
stream in your local media player (mpv, VLC, or IINA) — no browser tabs, no ads.

## 📱 Now also a full app

This repo is migrating from a CLI to a full **Expo app** (iOS / iPadOS / web)
with a Liquid Glass interface, categories, a personalized recommendation feed,
and series/episode browsing — while keeping the CLI working.

```
movie-cli/
  src/                 shared scraper + the original CLI
  supabase/functions/  hosted API: tmdb · streams · proxy  (Deno edge functions)
  extractor/           hosted Playwright stream-extraction worker (Docker)
  app/                 the Expo app  (see app/README.md)
```

Because a phone can't run a headless browser, the architecture is fully hosted:
the **Expo app** calls **Supabase Edge Functions**, which call a small **hosted
extractor** that reuses this repo's Playwright scraper. The app works anywhere
with no dependency on your laptop.

- App setup & run: [`app/README.md`](./app/README.md)
- Backend/extractor deploy ($0 hosting options): [`extractor/README.md`](./extractor/README.md)

The CLI documentation below still applies to the `mov-cli` command.

## Demo

> Demo GIF coming soon

## Requirements

- **Bun ≥ 1.1** *or* **Node.js ≥ 18**
- A media player: **mpv** (recommended), **VLC**, or **IINA** (macOS)
- **Playwright Chromium** — auto-installed on first run

## Quick Start

```sh
# With Bun
bunx mov-cli

# With Node / npx
npx mov-cli

# Install globally (optional)
bun add -g mov-cli
npm install -g mov-cli
```

## Usage

Running `mov-cli` with no arguments starts interactive mode:

1. Type a movie title to search.
2. Pick a result from the numbered list.
3. Choose a stream quality (or let it pick the best).
4. The stream opens in your detected player.
5. When the player closes, search for another or quit.

### CLI flags

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--player` | `-p` | auto-detect | Force a specific player (`mpv`, `vlc`, `cvlc`, `iina`) |
| `--provider` | `-P` | `cineby` | Scraping provider to use |
| `--quality` | `-q` | `best` | Preferred quality (`best`, `1080p`, `720p`, `480p`) |
| `--no-headless` | | (headless) | Show the Playwright browser window (debugging) |
| `--debug` | `-d` | `false` | Verbose debug logging |
| `--version` | `-v` | | Print version and exit |
| `--list-players` | | `false` | Print detected players and exit |
| `--list-providers` | | `false` | Print available providers and exit |

### Examples

```sh
# Force VLC and prefer 720p
mov-cli --player vlc --quality 720p

# Use the fallback provider with a visible browser window
mov-cli --provider vidsrc --no-headless --debug

# Just check what's installed
mov-cli --list-players
mov-cli --list-providers
```

### Environment variables

| Variable | Effect |
|----------|--------|
| `MOV_CLI_DEBUG=1` | Same as `--debug`; enables verbose logging to stderr |

## Configuration

`mov-cli` stores preferences at:

```
~/.config/mov-cli/config.json
```

| Key | Description |
|-----|-------------|
| `player` | Last detected/selected player binary |
| `provider` | Preferred provider |
| `quality` | Preferred quality |
| `tmdbApiKey` | Your own TMDB API key (used by the vidsrc provider for search) |

The file is created automatically. Add a `tmdbApiKey` to avoid the shared demo
key's rate limits.

## Providers

| Provider | Status | Notes |
|----------|--------|-------|
| `cineby` | Active (default) | Scrapes cineby.rs; prefers its JSON search API, falls back to DOM scraping and browser-based stream capture |
| `vidsrc` | Fallback | TMDB-powered search + vidsrc.to embed stream capture |

If the chosen provider returns nothing, `mov-cli` automatically tries the next
one in the chain before giving up.

## Player Support

| Player | macOS | Linux | Windows | Notes |
|--------|:-----:|:-----:|:-------:|-------|
| mpv | ✅ | ✅ | ✅ | Recommended; best HLS handling |
| VLC | ✅ | ✅ | ✅ | `vlc` (GUI) and `cvlc` (headless) |
| IINA | ✅ | — | — | macOS only |

## How It Works

1. **Search** — the provider queries a JSON API (or TMDB) and, if needed, falls
   back to scraping rendered HTML with a real browser.
2. **Browser automation** — Playwright drives a headless Chromium instance.
3. **Ad blocking** — `@cliqz/adblocker-playwright` loads prebuilt ad/tracker
   filter lists and blocks them on every page. Popups are auto-closed and heavy
   image/media/font resources are trimmed so pages load fast and clean.
4. **Stream extraction** — `mov-cli` watches network traffic, follows embed
   iframes, and captures `.m3u8`/`.mp4` URLs as the player loads them. Master
   HLS playlists are parsed into individual quality variants.
5. **Playback** — the captured stream URL (with the correct `Referer`) is handed
   to your local player.

## Building from Source

```sh
git clone https://github.com/yourusername/mov-cli
cd mov-cli
bun install
bun run dev          # Run without building
bun run build        # Bundle to dist/
bun run lint         # Type-check (tsc --noEmit)
```

## Troubleshooting

**No streams found.** Streaming sites change their markup and embed hosts
frequently. Try `--provider vidsrc`, re-run with `--debug` to see what was
captured, or use `--no-headless` to watch the browser. If a title genuinely has
no working source, `mov-cli` will tell you after trying every provider.

**Player not found.** Install mpv (recommended):

- macOS: `brew install mpv`
- Linux: `sudo apt install mpv` (or your distro's package manager)
- Windows: `winget install mpv` or `scoop install mpv`

Then re-run `mov-cli --list-players` to confirm it's detected.

**Playwright install fails.** On first run `mov-cli` runs
`playwright install chromium`. If it fails (often a permissions or sandbox
issue on Linux), install it manually:

```sh
npx playwright install chromium --with-deps
```

**Terminal cursor missing after Ctrl+C.** `mov-cli` restores the cursor on
clean exit. If a hard kill leaves it hidden, run `reset` or `tput cnorm`.

## Contributing

Contributions are welcome. To add a provider, implement the `Provider`
interface in `src/scraper/types.ts` and register it in
`src/scraper/index.ts`. To add a stream host extractor, implement the
`Extractor` interface and register it in `src/scraper/extractors/index.ts`.
Run `bun run lint` before opening a PR.

## Disclaimer

This tool is for educational purposes. Only use it to access content you have
the right to watch. The authors do not host, distribute, or endorse any
copyrighted content, and are not responsible for how this tool is used.

## License

MIT — see [LICENSE](./LICENSE).
