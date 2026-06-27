# Portable stream-extractor container.
#
# Build context MUST be the repo root (the worker imports the shared scraper
# from ../../src), e.g.:
#   docker build -f extractor/Dockerfile -t movie-extractor .
#
# Runs on any container host. Binds 0.0.0.0:$PORT (default 7860, which
# Hugging Face Spaces expects). Set EXTRACTOR_SECRET to lock down /extract.

FROM oven/bun:1-debian

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json bun.lock bunfig.toml tsconfig.json ./
RUN bun install --frozen-lockfile

# Install Chromium + its OS dependencies via Playwright.
RUN bunx playwright install --with-deps chromium

# Application source (shared scraper + the worker).
COPY src ./src
COPY extractor ./extractor

# Chromium must run with --no-sandbox as root inside a container, and
# --disable-dev-shm-usage avoids crashes on hosts with a small /dev/shm.
ENV CHROMIUM_ARGS="--no-sandbox --disable-dev-shm-usage"
ENV PORT=7860

EXPOSE 7860

CMD ["bun", "run", "extractor/src/server.ts"]
