import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import { browserManager } from "../browser/index.js";
import { getStreamsWithFallback } from "../scraper/index.js";
import type { SearchResult } from "../scraper/types.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dir, "ui.html"), "utf8");

const TMDB_PROXY = "https://db.videasy.to/3";
const OFFICIAL_BASE = "https://api.themoviedb.org/3";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const DEFAULT_PORT = 7891;

// ── TMDB helpers ────────────────────────────────────────────
async function tmdbBases(): Promise<string[]> {
  const config = await readConfig();
  return config.tmdbApiKey ? [OFFICIAL_BASE, TMDB_PROXY] : [TMDB_PROXY, OFFICIAL_BASE];
}

async function proxyTmdb(path: string): Promise<unknown> {
  const bases = await tmdbBases();
  const config = await readConfig();
  const keyParam = config.tmdbApiKey ? `&api_key=${config.tmdbApiKey}` : "";

  for (const base of bases) {
    try {
      const url = `${base}${path}${path.includes("?") ? keyParam : "?" + keyParam.slice(1)}`;
      const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA } });
      if (res.ok) return res.json();
      logger.debug(`TMDB ${base} → ${res.status}`);
    } catch (err) {
      logger.debug(`TMDB ${base} threw:`, err);
    }
  }
  throw new Error("All TMDB endpoints failed");
}

// ── Browser lifecycle ────────────────────────────────────────
let browserReady = false;
let browserError: string | null = null;

async function ensureBrowser(): Promise<void> {
  if (browserReady) return;
  if (browserError) throw new Error(browserError);

  try {
    logger.debug("Initialising headless browser for stream extraction…");
    await browserManager.init(true);
    browserReady = true;
  } catch (err) {
    const msg = String(err);
    // Distill the most actionable part of Playwright launch errors.
    if (msg.includes("Timeout") || msg.includes("launch")) {
      browserError =
        "BROWSER_LAUNCH_FAILED: Playwright could not start the headless browser. " +
        "Run: bunx playwright install chromium";
    } else {
      browserError = msg;
    }
    throw new Error(browserError);
  }
}

// ── Body reader ──────────────────────────────────────────────
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => resolve(body));
  });
}

// ── HLS proxy ────────────────────────────────────────────────
// Fetches a URL server-side and returns it with CORS headers.
// For m3u8 playlists, rewrites relative/absolute segment URLs so
// subsequent fetches also flow through this proxy (needed when the
// stream CDN enforces Referer or blocks direct browser access).
async function handleHlsProxy(
  url: URL,
  res: ServerResponse,
): Promise<void> {
  const rawTarget = url.searchParams.get("url");
  const referer = url.searchParams.get("referer") ?? "";

  if (!rawTarget) {
    res.writeHead(400);
    res.end("Missing url param");
    return;
  }

  const target = decodeURIComponent(rawTarget);

  try {
    const upstream = await fetch(target, {
      headers: {
        "User-Agent": UA,
        ...(referer ? { Referer: decodeURIComponent(referer) } : {}),
      },
    });

    const ct = upstream.headers.get("content-type") ?? "";
    const isPlaylist = ct.includes("mpegurl") || target.split("?")[0]?.endsWith(".m3u8");

    if (isPlaylist) {
      const text = await upstream.text();
      const base = new URL(target);
      const enc = (u: string) => encodeURIComponent(u);

      const rewritten = text
        .split("\n")
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) return line;
          const abs = new URL(trimmed, base).href;
          return `/hls-proxy?url=${enc(abs)}&referer=${enc(referer)}`;
        })
        .join("\n");

      res.writeHead(200, {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
      });
      res.end(rewritten);
    } else {
      const buf = await upstream.arrayBuffer();
      res.writeHead(upstream.status, {
        "Content-Type": ct || "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      });
      res.end(Buffer.from(buf));
    }
  } catch (err) {
    logger.debug("hls-proxy error:", err);
    res.writeHead(502);
    res.end("Proxy error");
  }
}

// ── Server ───────────────────────────────────────────────────
export function startServer(port: number = DEFAULT_PORT): Promise<{ close(): void; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      res.setHeader("Access-Control-Allow-Origin", "*");

      // ── HTML ──────────────────────────────────────────────
      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(HTML);
        return;
      }

      // ── TMDB API proxy ─────────────────────────────────────
      if (url.pathname.startsWith("/api/") && req.method === "GET") {
        const tmdbPath = url.pathname.replace("/api", "") + (url.search || "");
        try {
          const data = await proxyTmdb(tmdbPath);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data));
        } catch {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "upstream failed" }));
        }
        return;
      }

      // ── Stream extraction ──────────────────────────────────
      if (url.pathname === "/api/streams" && req.method === "POST") {
        try {
          const body = await readBody(req);
          const { id, title, type, year, provider = "cineby" } = JSON.parse(body) as {
            id: string;
            title: string;
            type: "movie" | "series";
            year: number | null;
            provider?: string;
          };

          const result: SearchResult = {
            id,
            title,
            type,
            year,
            rating: null,
            poster: null,
            provider,
          };

          await ensureBrowser();
          const streams = await getStreamsWithFallback(provider, result);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ streams }));
        } catch (err) {
          logger.debug("streams error:", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      // ── Image proxy ────────────────────────────────────────
      if (url.pathname.startsWith("/img/")) {
        const imgPath = url.pathname.replace("/img", "");
        const tmdbImgUrl = `https://image.tmdb.org/t/p${imgPath}`;
        try {
          const imgRes = await fetch(tmdbImgUrl, { headers: { "User-Agent": UA } });
          if (imgRes.ok) {
            const buf = await imgRes.arrayBuffer();
            const ct = imgRes.headers.get("content-type") ?? "image/jpeg";
            res.writeHead(200, { "Content-Type": ct, "Cache-Control": "public, max-age=86400" });
            res.end(Buffer.from(buf));
          } else {
            res.writeHead(imgRes.status);
            res.end();
          }
        } catch {
          res.writeHead(502);
          res.end();
        }
        return;
      }

      // ── HLS proxy ──────────────────────────────────────────
      if (url.pathname === "/hls-proxy") {
        await handleHlsProxy(url, res);
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    server.listen(port, "127.0.0.1", () => {
      resolve({ close: () => server.close(), port });
    });
  });
}

// Standalone entrypoint
if (process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1]!.split("/").pop()!)) {
  const { port } = await startServer(DEFAULT_PORT);
  console.log(`\n  MOV-CLI Web\n`);
  console.log(`  http://localhost:${port}\n`);
  process.on("SIGINT", async () => {
    if (browserReady) await browserManager.close();
    process.exit(0);
  });
}
