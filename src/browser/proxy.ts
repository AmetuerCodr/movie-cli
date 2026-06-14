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
  body{background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;color:#fff;overflow:hidden}
  video{width:100vw;height:100vh;object-fit:contain;outline:none;cursor:pointer}
  #overlay{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.7);z-index:10;cursor:pointer}
  #overlay svg{width:80px;height:80px;opacity:.9}
  #overlay h1{font-size:1.1rem;margin-top:1rem;opacity:.8;text-align:center;padding:0 1.5rem;max-width:600px}
  #overlay p{font-size:.8rem;margin-top:.5rem;opacity:.5}
  #err{position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);background:#c00;color:#fff;padding:.5rem 1rem;border-radius:6px;font-size:.85rem;display:none;z-index:20;max-width:90vw;text-align:center}
</style>
</head>
<body>
<div id="overlay">
  <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="38" fill="rgba(255,255,255,0.15)" stroke="white" stroke-width="2"/>
    <polygon points="32,22 62,40 32,58" fill="white"/>
  </svg>
  <h1>${escHtml(title)}</h1>
  <p>Click to play</p>
</div>
<div id="err"></div>
<video id="v" controls playsinline></video>

<script>
(function() {
  var video = document.getElementById('v');
  var overlay = document.getElementById('overlay');
  var errBox = document.getElementById('err');
  var src = ${JSON.stringify(src)};
  var hls;

  function showErr(msg) {
    errBox.textContent = msg;
    errBox.style.display = 'block';
    setTimeout(function(){ errBox.style.display = 'none'; }, 8000);
  }

  function setupHls() {
    if (typeof Hls === 'undefined') { showErr('HLS.js failed to load — check your internet connection.'); return; }
    if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, function(_, d) {
        if (d.fatal) showErr('Stream error: ' + d.details + ' (' + d.type + ')');
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
    } else {
      showErr('HLS not supported. Use Chrome or Firefox.');
    }
  }

  function startPlay() {
    overlay.style.display = 'none';
    video.play().catch(function(e) { showErr('Playback error: ' + e.message); });
  }

  overlay.addEventListener('click', startPlay);
  video.addEventListener('click', function() {
    if (video.paused) video.play().catch(function(){});
    else video.pause();
  });
  video.addEventListener('playing', function() { overlay.style.display = 'none'; });

  // Load HLS.js from CDN, then init
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
  s.onload = setupHls;
  s.onerror = function() { showErr('Failed to load HLS.js — check internet.'); };
  document.head.appendChild(s);
})();
</script>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
