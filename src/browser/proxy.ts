/**
 * Local HLS reverse-proxy for browser playback.
 *
 * The CDN (goldweather.net, etc.) requires a specific Referer + User-Agent that
 * browsers cannot inject on cross-origin media requests. This proxy intercepts
 * every HLS request from the browser, adds the correct headers, rewrites .m3u8
 * segment URLs to route back through the proxy, and streams the response.
 *
 * Usage:
 *   const { url, close } = await startProxyServer(stream);
 *   open(url);            // open in any browser — video plays
 *   await close();        // shut down when done
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import type { Stream } from "../scraper/types.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface ProxyServer {
  /** URL to open in the browser */
  url: string;
  /** Shut the server down */
  close(): Promise<void>;
}

export async function startProxyServer(stream: Stream, title: string): Promise<ProxyServer> {
  const referer = stream.referer ?? "https://player.videasy.to/";

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res, stream, referer, title);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  stream: Stream,
  referer: string,
  title: string,
): Promise<void> {
  try {
    const pathname = req.url ?? "/";

    // ── Player page ─────────────────────────────────────────────────────────
    if (pathname === "/" || pathname === "/player") {
      const proxyPath = `/proxy/${encodeURIComponent(stream.url)}`;
      const html = buildHtml(title, proxyPath);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(html);
      return;
    }

    // ── HLS proxy ───────────────────────────────────────────────────────────
    if (pathname.startsWith("/proxy/")) {
      const encoded = pathname.slice("/proxy/".length);
      let targetUrl: string;
      try {
        targetUrl = decodeURIComponent(encoded);
      } catch {
        res.writeHead(400);
        res.end("Bad URL");
        return;
      }

      // Handle preflight CORS
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const upstream = await globalThis.fetch(targetUrl, {
        headers: {
          Referer: referer,
          Origin: new URL(referer).origin,
          "User-Agent": UA,
          Accept: "*/*",
        },
      });

      const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
      const isM3U8 =
        targetUrl.includes(".m3u8") ||
        contentType.includes("mpegurl") ||
        contentType.includes("m3u8");

      res.writeHead(upstream.status, {
        "Content-Type": isM3U8 ? "application/vnd.apple.mpegurl" : contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });

      if (!upstream.body) {
        res.end();
        return;
      }

      if (isM3U8) {
        const text = await upstream.text();
        const rewritten = rewriteM3u8(text, targetUrl);
        res.end(rewritten);
      } else {
        // Stream binary (video segments)
        const reader = upstream.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      }
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end(String(err));
    }
  }
}

/**
 * Rewrite all segment/variant URLs in an m3u8 manifest to go through the
 * local proxy. Handles absolute URLs, relative URLs, and URI= values inside
 * #EXT-X-KEY and #EXT-X-MAP tags.
 */
function rewriteM3u8(content: string, baseUrl: string): string {
  const base = new URL(baseUrl);

  const proxyUrl = (raw: string): string => {
    const absolute = raw.startsWith("http") ? raw : new URL(raw, base).toString();
    return `/proxy/${encodeURIComponent(absolute)}`;
  };

  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();

      // Blank or non-URL tag lines — leave as-is
      if (!trimmed) return line;

      // Rewrite URI="..." attributes inside tags (EXT-X-KEY, EXT-X-MAP, etc.)
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => `URI="${proxyUrl(uri)}"`);
      }

      // Segment or variant playlist line (not a comment)
      return proxyUrl(trimmed);
    })
    .join("\n");
}

function buildHtml(title: string, src: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escHtml(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;color:#fff}
  h1{font-size:1rem;opacity:.6;margin-bottom:.5rem;text-align:center;padding:0 1rem}
  video{width:100vw;max-height:100vh;outline:none}
</style>
</head>
<body>
<h1>${escHtml(title)}</h1>
<video id="v" controls autoplay playsinline></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js"></script>
<script>
const video = document.getElementById('v');
const src = ${JSON.stringify(src)};
function play() {
  if (Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true });
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (d.fatal) console.error('HLS fatal', d.type, d.details);
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;
    video.play().catch(() => {});
  } else {
    document.body.innerHTML = '<p style="color:red;padding:2rem">HLS not supported in this browser. Try Chrome or Firefox.</p>';
  }
}
play();
</script>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
