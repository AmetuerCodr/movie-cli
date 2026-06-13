import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig } from "../utils/config.js";
import { logger } from "../utils/logger.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dir, "ui.html"), "utf8");

const TMDB_PROXY = "https://db.videasy.to/3";
const OFFICIAL_BASE = "https://api.themoviedb.org/3";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const DEFAULT_PORT = 7891;

async function tmdbBase(): Promise<string[]> {
  const config = await readConfig();
  return config.tmdbApiKey ? [OFFICIAL_BASE, TMDB_PROXY] : [TMDB_PROXY, OFFICIAL_BASE];
}

async function proxyTmdb(path: string): Promise<unknown> {
  const bases = await tmdbBase();
  const config = await readConfig();
  const keyParam = config.tmdbApiKey ? `&api_key=${config.tmdbApiKey}` : "";

  for (const base of bases) {
    try {
      const url = `${base}${path}${path.includes("?") ? keyParam : "?" + keyParam.slice(1)}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": UA },
      });
      if (res.ok) return res.json();
      logger.debug(`TMDB proxy ${base} returned ${res.status}`);
    } catch (err) {
      logger.debug(`TMDB proxy ${base} threw:`, err);
    }
  }
  throw new Error("All TMDB endpoints failed");
}

export function startServer(port: number = DEFAULT_PORT): Promise<{ close(): void; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      res.setHeader("Access-Control-Allow-Origin", "*");

      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(HTML);
        return;
      }

      if (url.pathname.startsWith("/api/")) {
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

      // Proxy TMDB images to avoid CDN CORS / network restrictions.
      // /img/w342/abc.jpg  →  https://image.tmdb.org/t/p/w342/abc.jpg
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

      res.writeHead(404);
      res.end("Not found");
    });

    server.listen(port, "127.0.0.1", () => {
      resolve({
        close: () => server.close(),
        port,
      });
    });
  });
}

// Standalone entrypoint when run directly.
if (process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1]!.split("/").pop()!)) {
  const { port } = await startServer(DEFAULT_PORT);
  console.log(`\n  🎬  MOV-CLI Web UI\n`);
  console.log(`  Open: \x1b[36mhttp://localhost:${port}\x1b[0m\n`);
  console.log(`  Press Ctrl+C to stop.\n`);
}
