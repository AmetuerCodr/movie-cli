# mov-cli — Build & Debug Session Summary

A chronological record of how `mov-cli` was built and debugged in this session,
including the root causes of the two major bugs and how they were fixed.

## Goal

Build **`mov-cli`** — a cross-platform, zero-install movie-watching CLI in
**TypeScript on Bun** (Node-compatible for `npx`/`bunx`), modeled after
[ani-cli](https://github.com/pystardust/ani-cli). The user searches for a movie,
picks a result, selects a quality, and the stream opens in a local media player
(mpv / VLC / IINA). Scraping uses Playwright with `@cliqz/adblocker-playwright`
for ad blocking.

## Environment

- Repo: `AmetuerCodr/movie-cli`, started empty on branch
  `claude/mov-cli-streaming-tool-ye79b7`.
- Runtime: Bun 1.3.11, Node 22.
- Work was pushed to both the feature branch and (at the user's request) `main`.

---

## Phase 1 — Initial build

Scaffolded the full project tree exactly per spec and implemented every module
(no stubs):

- **Entry/CLI**: `src/index.ts` (shebang, yargs flags, clean SIGINT/uncaught
  handlers), `src/cli.ts` (interactive search → select → quality → play loop).
- **Scrapers**: `src/scraper/` with `types.ts`, a cineby provider, a vidsrc
  fallback, a provider registry with fallback chain, and host extractors
  (streamtape, mixdrop, doodstream).
- **Browser**: `src/browser/` — a singleton `BrowserManager` plus an adblock
  helper (prebuilt ads/tracking lists, popup closing, image/media/font
  trimming, stream-URL capture).
- **Player**: `src/player/` — mpv/vlc/cvlc/iina configs, PATH auto-detection,
  `cross-spawn` launching.
- **UI**: `src/ui/` — gradient ASCII banner, ora spinner wrapper, inquirer
  prompts with chalk coloring.
- **Utils**: `src/utils/` — logger (`MOV_CLI_DEBUG`), `which`, persistent
  `~/.config/mov-cli/config.json`.
- Plus `package.json`, `tsconfig.json`, `bunfig.toml`, `.gitignore`, `LICENSE`,
  and a comprehensive `README.md`.

### Build deviations from the spec (and why)

1. **Playwright left external, not bundled.** Playwright can't be bundled — it
   uses dynamic `require`s (`chromium-bidi`) and ships its own browser binary.
   It stays a normal dependency that `npx`/`bunx` install, so the zero-install
   UX is unchanged.
2. **Dropped the `--banner '#!/usr/bin/env node'` build flag.** Bun already
   preserves the source shebang, so the banner produced a *duplicate* shebang on
   line 2 — a hard syntax error in Node. Removed it to leave exactly one.

Verified: `tsc --noEmit` clean, `bun run build` succeeds, `--version`,
`--help`, `--list-players`, `--list-providers` all work, and the no-player case
prints a friendly install hint and exits 1.

### Publishing note (how to enable plain `bunx mov-cli`)

`bunx`/`npx` resolve from the npm registry, so the one-time step is
`npm publish` (the `prepublishOnly` script builds first; `files` ships only
`dist/`, `README.md`, `LICENSE`). Caveats: the name "mov-cli" may be taken
(use a scoped name if so), and publishing needs Bun locally though end users
only need Node ≥ 18 or Bun. Pre-publish testing options: `bun run dev`,
`npm pack` + `npx ./tarball.tgz`, or `bun link`.

---

## Phase 2 — Bug #1: Playwright auto-install crash

**Symptom:** `Cannot find module 'playwright/cli'` when starting the browser.

**Root cause:** the first-run Chromium installer called
`require.resolve("playwright/cli")`. The `cli.js` file exists, but Playwright's
`exports` map in `package.json` doesn't expose that subpath, and both Node and
Bun strictly enforce exports maps — so the resolve threw. This only fires on the
first-run path where Chromium isn't installed yet.

**Fix:** resolve `playwright/package.json` (which *is* exported), then join
`cli.js` from the package root. Also fail with a clear manual-install hint
(`npx playwright install chromium`) instead of an unhandled error.

**Verified:** reproduced with no Chromium installed, ran the new install path
end-to-end (downloaded + installed Chromium), and confirmed Chromium launches
and renders. Resolution tested under both Bun and Node.

---

## Phase 3 — Bug #2: "No results found" on search

**Symptom:** the search prompt worked but returned zero results.

**Root cause (two independent issues):**

1. The cineby scraper pointed at **`cineby.rs`** (dead domain) and a guessed
   `/api/search` endpoint that never existed. The project moved to
   **`cineby.at`** (`cineby.app` redirects there), and it doesn't scrape HTML —
   it pulls its catalog from an **open, keyless TMDB mirror**
   (`db.videasy.to/3/...`).
2. The TMDB fallback "demo" key was **revoked** (`401 Invalid API key`), so the
   fallback was also empty.

**How it was found:** loaded the live site in a real browser and watched which
hosts its search actually called — revealing `db.videasy.to` as the data source.

**Fix:** both providers now search through a shared `src/scraper/tmdb.ts` helper
that uses the keyless mirror by default (or the official TMDB API if the user
sets `tmdbApiKey` in config).

**Verified:** through the exact provider registry the CLI uses — "inception"
returns 13 results (Inception 2010 on top), "the matrix" returns 20.

---

## Phase 4 — Bug #3: "No playable streams found"

**Symptom:** search worked, but selecting a title found no stream.

**Root cause:** stream extraction targeted `cineby.at/watch/movie/{id}`, which
**404s**. Cineby is a frontend over **videasy** and plays through the videasy
player embed, not a watch page on its own domain. Tracing the network on a real
movie page showed the chain: `player.videasy.to` → videasy source API → an HLS
stream served from `server.digitalsun.app/video.m3u8`.

**Fix:**

- Point extraction at `player.videasy.to/movie/{tmdbId}` (and
  `/tv/{id}/{season}/{episode}` for series). The existing network-capture logic
  was correct — it was just aimed at a dead URL.
- Enable Chromium autoplay (`--autoplay-policy=no-user-gesture-required`) so the
  player loads the stream on its own.
- Use a single click + passive wait (repeated clicks were toggling play/pause).
- Extend the stream wait window to 30s.

**Verified:** the videasy player yields a valid m3u8 **both with and without**
the production ad blocker applied, confirming extraction and adblocking coexist.

### Known caveat (environment-specific)

A fully reliable demo wasn't possible *from the sandbox* because:

- **videasy rate-limits the datacenter IP** — the first request captures the
  stream in ~2-6s, then repeated attempts from the same IP dry up temporarily.
  This is IP reputation, not a code bug; a residential IP shouldn't hit it the
  same way.
- The sandbox does **TLS interception**, so the headless browser rejected the
  cert (`ERR_CERT_AUTHORITY_INVALID`) until cert errors were ignored *for
  probing only* — production code correctly does **not** ignore cert errors.

If a specific title returns empty, running with `--debug` shows whether the
player loaded and what URLs were captured, which guides further tuning (e.g.
videasy fallback server selection).

---

## Final state

- Search: working against the live keyless TMDB mirror.
- Stream extraction: aimed at the confirmed-working videasy player embed;
  validated end-to-end (with adblock) from a fresh request.
- All changes committed and pushed to both `main` and
  `claude/mov-cli-streaming-tool-ye79b7`.

### Key files touched across the session

| File | Purpose |
|------|---------|
| `src/scraper/tmdb.ts` | Shared keyless TMDB search helper (added in Phase 3) |
| `src/scraper/cineby.ts` | Primary provider; search via TMDB, streams via videasy player |
| `src/scraper/vidsrc.ts` | Fallback provider; shares TMDB search, vidsrc.to embeds |
| `src/scraper/index.ts` | Provider registry + fallback chain |
| `src/browser/index.ts` | BrowserManager; Playwright install fix + autoplay flag |
| `src/browser/adblock.ts` | Adblock + popup/resource trimming + stream capture |
| `src/cli.ts` / `src/index.ts` | Interactive loop + entry point/flags |

### Commits

1. Build mov-cli: terminal movie-streaming CLI
2. Fix Playwright auto-install: resolve cli.js via package.json
3. Fix "no results": use live data source for search
4. Fix stream extraction: target videasy player embed
