# Movie — Expo App

A cross-platform (iOS / iPadOS / web) movie & series app with a Liquid Glass
interface, categories, a personalized recommendation feed, and full series /
episode browsing. It talks only to your Supabase edge functions, so it works
anywhere with no dependency on a local server.

## Architecture

```
 Expo app  ──►  Supabase Edge Functions  ──►  Hosted extractor (Playwright)
 (this dir)      tmdb / streams / proxy        (../extractor)
                       │
                       └─►  TMDB  (browse / search / recommendations)
```

- **tmdb** — categories, trending, search, details, seasons/episodes, recs.
- **streams** — resolves a playable URL (calls the extractor), then rewrites it
  through **proxy** so HLS plays with the right `Referer`/`User-Agent`.
- Watch history, favorites, and continue-watching are stored **on-device**
  (AsyncStorage); the "For You" rail re-ranks TMDB recommendations by your
  taste. See `src/recommend.ts`.

## Setup

1. **Deploy the backend** (once):
   - Deploy the edge functions: from the repo root,
     `supabase functions deploy tmdb streams proxy --no-verify-jwt`
   - Deploy the extractor (see `../extractor/README.md`) and point the
     `streams` function at it:
     `supabase secrets set EXTRACTOR_URL=https://<host> EXTRACTOR_SECRET=<secret>`
   - (Optional) `supabase secrets set TMDB_API_KEY=<your key>` to use the
     official TMDB API instead of the keyless mirror.

2. **Configure the app**:
   ```sh
   cd app
   cp .env.example .env
   # set EXPO_PUBLIC_API_BASE to https://<project-ref>.supabase.co/functions/v1
   # set EXPO_PUBLIC_SUPABASE_ANON_KEY to your project's anon key
   npm install
   ```

## Run

- **On your phone/iPad (quickest):** `npx expo start`, then open the QR code in
  **Expo Go**. Works over any network.
- **Web (Mac):** `npx expo start --web`. (HLS plays natively in Safari; Chrome
  needs HLS support — Safari is recommended for web playback.)
- **Native build via Xcode / TestFlight:** `npx expo run:ios` for a local dev
  build, or `eas build -p ios` for a distributable build. `expo-video` and
  `expo-blur` need a dev build (not Expo Go) for full native playback/PiP.

## Project layout

```
app/
  app/                       expo-router screens
    (tabs)/                  Home · Search · Library
    title/[type]/[id].tsx    details + season/episode picker
    player.tsx               Liquid Glass video player
  src/
    api/                     edge-function client + wire types
    components/              GlassView, Rail, PosterCard, Screen
    storage/library.ts       on-device favorites/history/progress
    recommend.ts             personalized re-ranker
    theme.ts                 Liquid Glass design tokens
```
