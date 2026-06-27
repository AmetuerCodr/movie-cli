# Stream Extractor Worker

A small HTTP service that wraps the Playwright scraper so stream extraction can
run in the cloud (it can't run inside a Supabase Edge Function, which has no
browser). The `streams` edge function calls this worker; the app never talks to
it directly.

```
POST /extract   { id, type: "movie"|"series", season?, episode?, provider? }
                -> { streams: [{ url, quality, referer, isM3U8 }] }
GET  /health    -> { ok: true }
```

If `EXTRACTOR_SECRET` is set, `/extract` requires `Authorization: Bearer <secret>`.

## Build

The build context is the **repo root** (the worker imports the shared scraper):

```sh
docker build -f extractor/Dockerfile -t movie-extractor .
docker run -p 7860:7860 -e EXTRACTOR_SECRET=dev movie-extractor
```

## Deploy on a $0 budget

All of these can run the worker for free. Chromium wants ~1 GB RAM, so prefer a
host that gives you that.

### Option A — Hugging Face Spaces (no credit card, 16 GB RAM) — recommended

1. Create a new **Space** → SDK: **Docker** → Blank.
2. Push this repo into the Space (or point the Space at your GitHub repo).
   The Space needs `Dockerfile`, `src/`, `extractor/`, `package.json`,
   `bun.lock`, `bunfig.toml`, `tsconfig.json`.
   - The Space looks for `Dockerfile` at its root. Either move
     `extractor/Dockerfile` to the Space root, or set the Dockerfile path in the
     Space settings.
3. In **Settings → Variables and secrets**, add `EXTRACTOR_SECRET`.
4. The Space serves at `https://<user>-<space>.hf.space` on port 7860.

> Free Spaces sleep after ~48 h of inactivity and cold-start on the next
> request. Fine for personal use.

### Option B — Google Cloud Run (free tier; card required but not charged)

```sh
gcloud run deploy movie-extractor \
  --source . \
  --port 7860 \
  --memory 1Gi \
  --allow-unauthenticated \
  --set-env-vars EXTRACTOR_SECRET=<secret>
```

Cloud Run scales to zero, so you pay nothing while idle and stay within the
always-free request quota for personal use. (Uses the repo-root `Dockerfile`;
copy `extractor/Dockerfile` to the root or add a `cloudbuild.yaml` pointing at
it.)

### Option C — Render free web service (no card)

New → Web Service → Docker. Set Dockerfile Path `extractor/Dockerfile`, Docker
Build Context Directory `.`, add `EXTRACTOR_SECRET`. Note: the free instance is
512 MB RAM, which is tight for Chromium — it may be slow or occasionally OOM.

## Wire it to Supabase

After deploying, set these on the `streams` edge function:

```sh
supabase secrets set EXTRACTOR_URL=https://<your-worker-host> EXTRACTOR_SECRET=<secret>
```
