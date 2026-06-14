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
  :root{--glass:rgba(28,28,30,.72);--glass-border:rgba(255,255,255,.14);--accent:#fff;--blur:24px}
  body{background:#000;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;color:#fff;user-select:none}
  video{position:fixed;inset:0;width:100%;height:100%;object-fit:contain;z-index:0}

  /* ── Initial overlay ─────────────────────────────────── */
  #start{position:fixed;inset:0;z-index:30;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,rgba(0,0,0,.45) 0%,rgba(0,0,0,.85) 100%);transition:opacity .4s}
  #start.gone{opacity:0;pointer-events:none}
  #start-btn{width:88px;height:88px;border-radius:50%;background:var(--glass);border:1.5px solid var(--glass-border);backdrop-filter:blur(var(--blur)) saturate(180%);-webkit-backdrop-filter:blur(var(--blur)) saturate(180%);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform .15s,background .15s;box-shadow:0 8px 32px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.18)}
  #start-btn:hover{transform:scale(1.08);background:rgba(255,255,255,.18)}
  #start-btn:active{transform:scale(.96)}
  #start-btn svg{width:32px;height:32px;fill:#fff;margin-left:5px}
  #start-title{margin-top:1.4rem;font-size:1.25rem;font-weight:600;letter-spacing:-.01em;opacity:.92;text-align:center;padding:0 2rem;text-shadow:0 1px 8px rgba(0,0,0,.8)}
  #start-sub{margin-top:.35rem;font-size:.8rem;opacity:.4;letter-spacing:.04em;text-transform:uppercase}

  /* ── Chrome shell (fades out when idle) ──────────────── */
  #chrome{position:fixed;inset:0;z-index:20;pointer-events:none;transition:opacity .35s}
  #chrome.idle{opacity:0}
  #chrome.idle #bar,#chrome.idle #top-bar{pointer-events:none}
  #chrome:not(.idle) #bar,#chrome:not(.idle) #top-bar{pointer-events:all}

  /* Top bar */
  #top-bar{position:absolute;top:0;left:0;right:0;padding:1.4rem 2rem 3rem;background:linear-gradient(to bottom,rgba(0,0,0,.7) 0%,transparent 100%);display:flex;align-items:center;gap:1rem}
  #top-title{font-size:1rem;font-weight:600;letter-spacing:-.01em;opacity:.92;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

  /* Bottom control bar — liquid glass pill */
  #bar{position:absolute;bottom:0;left:0;right:0;padding:0 2rem 2.2rem;background:linear-gradient(to top,rgba(0,0,0,.72) 0%,transparent 100%)}
  #pill{background:var(--glass);border:1px solid var(--glass-border);backdrop-filter:blur(var(--blur)) saturate(180%);-webkit-backdrop-filter:blur(var(--blur)) saturate(180%);border-radius:20px;padding:14px 20px 16px;box-shadow:0 8px 40px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.12)}

  /* Scrubber row */
  #scrub-row{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  #time-cur,#time-dur{font-size:.72rem;font-weight:500;opacity:.65;min-width:38px;font-variant-numeric:tabular-nums;letter-spacing:.02em}
  #time-dur{text-align:right}
  #scrub-wrap{flex:1;height:20px;display:flex;align-items:center;cursor:pointer;position:relative}
  #scrub-track{width:100%;height:3px;background:rgba(255,255,255,.2);border-radius:3px;overflow:visible;position:relative;transition:height .15s}
  #scrub-wrap:hover #scrub-track{height:5px}
  #scrub-fill{height:100%;background:#fff;border-radius:3px;width:0%;position:relative;transition:width .1s linear}
  #scrub-fill::after{content:'';position:absolute;right:-6px;top:50%;transform:translateY(-50%);width:12px;height:12px;border-radius:50%;background:#fff;opacity:0;transition:opacity .15s;box-shadow:0 0 8px rgba(255,255,255,.6)}
  #scrub-wrap:hover #scrub-fill::after{opacity:1}

  /* Buttons row */
  #btn-row{display:flex;align-items:center;justify-content:space-between}
  #left-btns,#right-btns{display:flex;align-items:center;gap:4px}
  .ctrl{background:none;border:none;color:#fff;cursor:pointer;width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;transition:background .12s,transform .1s;opacity:.9}
  .ctrl:hover{background:rgba(255,255,255,.1);opacity:1}
  .ctrl:active{transform:scale(.9)}
  .ctrl svg{width:22px;height:22px;fill:#fff}
  #vol-wrap{display:flex;align-items:center;gap:6px}
  #vol-slider{-webkit-appearance:none;appearance:none;width:72px;height:3px;border-radius:3px;background:rgba(255,255,255,.25);outline:none;cursor:pointer}
  #vol-slider::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:#fff;cursor:pointer;box-shadow:0 0 6px rgba(255,255,255,.4)}

  /* Error toast */
  #err{position:fixed;bottom:6rem;left:50%;transform:translateX(-50%);background:rgba(200,0,0,.85);backdrop-filter:blur(12px);color:#fff;padding:.55rem 1.1rem;border-radius:10px;font-size:.82rem;display:none;z-index:40;max-width:88vw;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.4)}
</style>
</head>
<body>

<!-- Initial start overlay -->
<div id="start">
  <div id="start-btn">
    <svg viewBox="0 0 24 24"><path d="M8 5.14v14l11-7-11-7z"/></svg>
  </div>
  <div id="start-title">${escHtml(title)}</div>
  <div id="start-sub">Click to play</div>
</div>

<!-- Video -->
<video id="v" playsinline></video>

<!-- Chrome shell -->
<div id="chrome" class="idle">
  <div id="top-bar">
    <div id="top-title">${escHtml(title)}</div>
  </div>
  <div id="bar">
    <div id="pill">
      <div id="scrub-row">
        <span id="time-cur">0:00</span>
        <div id="scrub-wrap"><div id="scrub-track"><div id="scrub-fill"></div></div></div>
        <span id="time-dur">0:00</span>
      </div>
      <div id="btn-row">
        <div id="left-btns">
          <!-- Play/Pause -->
          <button class="ctrl" id="btn-pp" title="Play/Pause">
            <svg id="ico-pp" viewBox="0 0 24 24"><path d="M8 5.14v14l11-7-11-7z"/></svg>
          </button>
          <!-- Skip back 10s -->
          <button class="ctrl" id="btn-back" title="−10s">
            <svg viewBox="0 0 24 24"><path d="M12.5 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7V3z"/><path d="M12.5 3V7l-4-4 4-4v0z"/><text x="8.5" y="16" font-size="5" fill="#fff" font-family="sans-serif" font-weight="700">10</text></svg>
          </button>
          <!-- Skip forward 10s -->
          <button class="ctrl" id="btn-fwd" title="+10s">
            <svg viewBox="0 0 24 24"><path d="M11.5 3a9 9 0 1 1-9 9h2a7 7 0 1 0 7-7V3z"/><path d="M11.5 3V7l4-4-4-4v0z"/><text x="8.5" y="16" font-size="5" fill="#fff" font-family="sans-serif" font-weight="700">10</text></svg>
          </button>
          <!-- Volume -->
          <div id="vol-wrap">
            <button class="ctrl" id="btn-mute" title="Mute">
              <svg id="ico-vol" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
            </button>
            <input type="range" id="vol-slider" min="0" max="1" step="0.02" value="1">
          </div>
        </div>
        <div id="right-btns">
          <!-- Fullscreen -->
          <button class="ctrl" id="btn-fs" title="Fullscreen">
            <svg id="ico-fs" viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</div>

<div id="err"></div>

<script>
(function(){
  var v = document.getElementById('v');
  var start = document.getElementById('start');
  var chrome = document.getElementById('chrome');
  var fill = document.getElementById('scrub-fill');
  var scrubWrap = document.getElementById('scrub-wrap');
  var timeCur = document.getElementById('time-cur');
  var timeDur = document.getElementById('time-dur');
  var btnPP = document.getElementById('btn-pp');
  var icoPP = document.getElementById('ico-pp');
  var btnBack = document.getElementById('btn-back');
  var btnFwd = document.getElementById('btn-fwd');
  var btnMute = document.getElementById('btn-mute');
  var icoVol = document.getElementById('ico-vol');
  var volSlider = document.getElementById('vol-slider');
  var btnFs = document.getElementById('btn-fs');
  var icoFs = document.getElementById('ico-fs');
  var errBox = document.getElementById('err');
  var src = ${JSON.stringify(src)};

  var PLAY_ICON = '<path d="M8 5.14v14l11-7-11-7z"/>';
  var PAUSE_ICON = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
  var VOL_ON = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>';
  var VOL_OFF = '<path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>';
  var FS_IN = '<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>';
  var FS_OUT = '<path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>';

  function fmt(s){
    s = Math.floor(s||0);
    var h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
    return h ? h+':'+(m<10?'0':'')+m+':'+(sec<10?'0':'')+sec : m+':'+(sec<10?'0':'')+sec;
  }

  function showErr(msg){
    errBox.textContent = msg; errBox.style.display='block';
    clearTimeout(errBox._t); errBox._t = setTimeout(function(){errBox.style.display='none';}, 8000);
  }

  // ── HLS setup ──────────────────────────────────────────
  function setupHls(){
    if(typeof Hls==='undefined'){showErr('HLS.js failed to load — check internet.');return;}
    if(Hls.isSupported()){
      var hls = new Hls({enableWorker:true,lowLatencyMode:false});
      hls.loadSource(src); hls.attachMedia(v);
      hls.on(Hls.Events.ERROR, function(_,d){
        if(d.fatal) showErr('Stream error: '+d.details);
      });
    } else if(v.canPlayType('application/vnd.apple.mpegurl')){
      v.src = src;
    } else {
      showErr('HLS not supported — use Chrome or Firefox.');
    }
  }

  var hlsScript = document.createElement('script');
  hlsScript.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
  hlsScript.onload = setupHls;
  hlsScript.onerror = function(){showErr('Failed to load HLS.js — check internet.');};
  document.head.appendChild(hlsScript);

  // ── Start overlay ───────────────────────────────────────
  document.getElementById('start-btn').addEventListener('click', function(){
    start.classList.add('gone');
    v.play().catch(function(e){showErr(e.message);});
    showChrome();
  });

  // ── Controls idle hide ──────────────────────────────────
  var idleTimer;
  function showChrome(){
    chrome.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function(){chrome.classList.add('idle');}, 3500);
  }
  document.addEventListener('mousemove', showChrome);
  document.addEventListener('keydown', showChrome);
  chrome.addEventListener('mouseenter', function(){
    chrome.classList.remove('idle'); clearTimeout(idleTimer);
  });
  chrome.addEventListener('mouseleave', function(){
    idleTimer = setTimeout(function(){chrome.classList.add('idle');}, 1500);
  });

  // ── Space / arrow key shortcuts ────────────────────────
  document.addEventListener('keydown', function(e){
    if(e.target.tagName==='INPUT') return;
    if(e.code==='Space'){e.preventDefault(); togglePlay();}
    else if(e.code==='ArrowLeft'){e.preventDefault(); v.currentTime=Math.max(0,v.currentTime-10);}
    else if(e.code==='ArrowRight'){e.preventDefault(); v.currentTime=Math.min(v.duration||0,v.currentTime+10);}
    else if(e.code==='ArrowUp'){e.preventDefault(); v.volume=Math.min(1,v.volume+.1); volSlider.value=v.volume;}
    else if(e.code==='ArrowDown'){e.preventDefault(); v.volume=Math.max(0,v.volume-.1); volSlider.value=v.volume;}
    else if(e.code==='KeyF'){toggleFs();}
    else if(e.code==='KeyM'){v.muted=!v.muted; updateVolIcon();}
  });

  // ── Click on video area toggles play/pause ─────────────
  // Only fires if NOT clicking inside the pill controls
  document.addEventListener('click', function(e){
    var inPill = document.getElementById('pill').contains(e.target) || document.getElementById('top-bar').contains(e.target) || start.contains(e.target);
    if(!inPill && !start.classList.contains('gone')==false) togglePlay();
  });

  // ── Play / Pause ───────────────────────────────────────
  function togglePlay(){
    if(v.paused) v.play().catch(function(e){showErr(e.message);});
    else v.pause();
  }
  function updatePPIcon(){
    icoPP.innerHTML = v.paused ? PLAY_ICON : PAUSE_ICON;
  }
  btnPP.addEventListener('click', togglePlay);
  v.addEventListener('play', updatePPIcon);
  v.addEventListener('pause', updatePPIcon);
  v.addEventListener('playing', function(){
    start.classList.add('gone');
    updatePPIcon();
  });

  // ── Skip ──────────────────────────────────────────────
  btnBack.addEventListener('click', function(){v.currentTime=Math.max(0,v.currentTime-10);});
  btnFwd.addEventListener('click', function(){v.currentTime=Math.min(v.duration||0,v.currentTime+10);});

  // ── Volume ────────────────────────────────────────────
  function updateVolIcon(){
    icoVol.innerHTML = (v.muted||v.volume===0) ? VOL_OFF : VOL_ON;
    volSlider.value = v.muted ? 0 : v.volume;
  }
  btnMute.addEventListener('click', function(){v.muted=!v.muted; updateVolIcon();});
  volSlider.addEventListener('input', function(){
    v.volume = parseFloat(this.value);
    v.muted = (v.volume===0);
    updateVolIcon();
  });

  // ── Progress ─────────────────────────────────────────
  v.addEventListener('timeupdate', function(){
    if(!v.duration) return;
    var pct = (v.currentTime/v.duration)*100;
    fill.style.width = pct+'%';
    timeCur.textContent = fmt(v.currentTime);
    timeDur.textContent = fmt(v.duration);
  });
  v.addEventListener('loadedmetadata', function(){
    timeDur.textContent = fmt(v.duration);
  });

  // Scrub
  var scrubbing = false;
  function scrubTo(e){
    var rect = scrubWrap.getBoundingClientRect();
    var x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if(v.duration) v.currentTime = x * v.duration;
  }
  scrubWrap.addEventListener('mousedown', function(e){scrubbing=true; scrubTo(e);});
  document.addEventListener('mousemove', function(e){if(scrubbing) scrubTo(e);});
  document.addEventListener('mouseup', function(){scrubbing=false;});

  // ── Fullscreen ────────────────────────────────────────
  function toggleFs(){
    if(!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function(){});
    else document.exitFullscreen().catch(function(){});
  }
  btnFs.addEventListener('click', toggleFs);
  document.addEventListener('fullscreenchange', function(){
    icoFs.innerHTML = document.fullscreenElement ? FS_OUT : FS_IN;
  });
})();
</script>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
