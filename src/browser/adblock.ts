import { PlaywrightBlocker } from "@cliqz/adblocker-playwright";
import type { Page } from "playwright";
import fetch from "node-fetch";
import { logger } from "../utils/logger.js";

let cached: PlaywrightBlocker | null = null;

/**
 * Build (and memoize) a PlaywrightBlocker loaded with the prebuilt ads and
 * tracking filter lists.
 */
export async function getBlocker(): Promise<PlaywrightBlocker> {
  if (cached) return cached;
  logger.debug("Loading adblock filter lists...");
  cached = await PlaywrightBlocker.fromPrebuiltAdsAndTracking(
    fetch as unknown as typeof globalThis.fetch,
  );
  logger.debug("Adblock filter lists loaded");
  return cached;
}

/**
 * Apply ad blocking and aggressive resource trimming to a page. Captured
 * stream URLs are pushed into `streamSink` as they are observed.
 */
export async function applyAdblock(page: Page, streamSink: string[]): Promise<void> {
  const blocker = await getBlocker();
  await blocker.enableBlockingInPage(page);

  page.on("popup", (popup) => {
    logger.debug("Closing popup:", popup.url());
    popup.close().catch(() => {});
  });

  page.on("request", (req) => {
    const url = req.url();
    if (isStreamUrl(url)) {
      logger.debug("Captured candidate stream:", url);
      if (!streamSink.includes(url)) streamSink.push(url);
    }
  });

  await page.route("**/*", (route) => {
    const req = route.request();
    const type = req.resourceType();
    const url = req.url();

    if (isStreamUrl(url)) {
      route.continue().catch(() => {});
      return;
    }

    if (type === "image" || type === "media" || type === "font") {
      route.abort().catch(() => {});
      return;
    }

    route.continue().catch(() => {});
  });
}

export function isStreamUrl(url: string): boolean {
  return (
    url.includes(".m3u8") ||
    url.includes(".mp4") ||
    /\.ts(\?|$)/.test(url) ||
    /\/hls\/|\/dash\//.test(url)
  );
}

// ---------------------------------------------------------------------------
// JS-level interception init script
// ---------------------------------------------------------------------------

/**
 * Script injected via page.addInitScript BEFORE any page JS runs.
 * Monkey-patches fetch() and XMLHttpRequest so that every URL the page
 * requests is inspected. Stream-like URLs (.m3u8, .mp4) are stored in
 * window.__capturedStreams for later retrieval. This is more reliable than
 * Playwright's network events because it captures URLs at the JS layer —
 * even when they originate from inside Web Workers or HLS.js internals.
 *
 * It also intercepts CryptoJS-decrypted source data by patching JSON.parse
 * to look for objects with a "sources" array containing objects with "url"
 * or "file" fields.
 */
const CAPTURE_INIT_SCRIPT = `
  window.__capturedStreams = [];
  window.__capturedSources = [];
  window.__decryptedPayloads = [];
  window.__rawResponses = [];

  // --- Stealth: hide headless indicators before any page JS runs ---
  try {
    Object.defineProperty(navigator, 'webdriver', { get: function() { return undefined; }, configurable: true });
  } catch(e) {}
  // Override userAgentData.brands to remove the "HeadlessChrome" entry that
  // fingerprinting services use to identify bot traffic.
  try {
    const _brands = [
      { brand: 'Not/A)Brand', version: '8' },
      { brand: 'Chromium', version: '124' },
      { brand: 'Google Chrome', version: '124' },
    ];
    const _uad = {
      brands: _brands,
      mobile: false,
      platform: 'Windows',
      getHighEntropyValues: async function(hints) {
        return {
          brands: _brands,
          fullVersionList: _brands.map(function(b) { return { brand: b.brand, version: b.version + '.0.6367.155' }; }),
          mobile: false,
          platform: 'Windows',
          platformVersion: '10.0.0',
          architecture: 'x86',
          bitness: '64',
          model: '',
          uaFullVersion: '124.0.6367.155',
        };
      },
    };
    Object.defineProperty(navigator, 'userAgentData', { get: function() { return _uad; }, configurable: true });
  } catch(e) {}

  function __pushStream(url) {
    if (typeof url !== 'string' || !url) return;
    if (url.startsWith('blob:') || url.startsWith('data:')) return;
    if (
      url.includes('.m3u8') ||
      url.includes('.mp4') ||
      /\\.ts(\\?|$)/.test(url) ||
      /\\/hls\\/|\\/dash\\//.test(url)
    ) {
      if (!window.__capturedStreams.includes(url)) {
        window.__capturedStreams.push(url);
      }
    }
  }

  // Recursively inspect a decoded object for stream URLs.
  function __inspectObj(obj, depth) {
    if (!obj || depth > 4 || typeof obj !== 'object') return;
    try {
      if (Array.isArray(obj.sources)) {
        for (const s of obj.sources) {
          const u = s.url || s.file || s.link || s.src || s.stream || '';
          if (u && typeof u === 'string') {
            __pushStream(u);
            window.__capturedSources.push({ url: u, quality: s.quality || s.label || s.res || 'unknown' });
          }
        }
      }
      const directUrl = obj.url || obj.file || obj.stream || obj.src || '';
      if (directUrl && typeof directUrl === 'string') __pushStream(directUrl);
      for (const key of ['data', 'result', 'response', 'payload', 'content', 'media', 'tracks']) {
        if (obj[key] && typeof obj[key] === 'object') __inspectObj(obj[key], depth + 1);
      }
    } catch(e) {}
  }

  function __tryParseJson(text) {
    try {
      const t = text.trim();
      if (t.startsWith('{') || t.startsWith('[')) {
        const parsed = JSON.parse(t);
        __inspectObj(parsed, 0);
        if (Array.isArray(parsed)) parsed.forEach(function(item) { __inspectObj(item, 0); });
      }
    } catch(e) {}
  }

  // --- Patch fetch: capture URL + peek response body for relevant endpoints ---
  const _origFetch = window.fetch;
  window.fetch = function(input, init) {
    const url = (typeof input === 'string') ? input : (input && input.url ? input.url : '');
    try { __pushStream(url); } catch(e) {}
    const p = _origFetch.apply(this, arguments);
    if (url && (url.includes('sources') || url.includes('videasy') || url.includes('embed') || url.includes('.m3u8'))) {
      p.then(function(resp) {
        try {
          resp.clone().text().then(function(body) {
            window.__rawResponses.push({ url: url, snippet: body.substring(0, 500) });
            __tryParseJson(body);
          }).catch(function(){});
        } catch(e) {}
      }).catch(function(){});
    }
    return p;
  };

  // --- Patch XHR ---
  const _origXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    try { __pushStream(String(url)); } catch(e) {}
    return _origXhrOpen.apply(this, arguments);
  };

  // --- Patch JSON.parse ---
  const _origJsonParse = JSON.parse;
  JSON.parse = function(text) {
    const result = _origJsonParse.apply(this, arguments);
    try {
      __inspectObj(result, 0);
      if (Array.isArray(result)) result.forEach(function(item) { __inspectObj(item, 0); });
    } catch(e) {}
    return result;
  };

  // --- Intercept video.src setter ---
  try {
    const _srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (_srcDesc && _srcDesc.set) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        set: function(val) {
          try { __pushStream(String(val)); } catch(e) {}
          _srcDesc.set.call(this, val);
        },
        get: function() { return _srcDesc.get.call(this); },
        configurable: true
      });
    }
  } catch(e) {}

  // --- Poll for HLS.js and CryptoJS (both may load asynchronously) ---
  function __patchLibs() {
    // HLS.js: intercept loadSource — called with the plain .m3u8 URL before blob conversion
    if (window.Hls && !window.Hls.__movCliPatched) {
      window.Hls.__movCliPatched = true;
      const _origLS = window.Hls.prototype.loadSource;
      window.Hls.prototype.loadSource = function(src) {
        try { __pushStream(String(src)); } catch(e) {}
        return _origLS.call(this, src);
      };
    }
    // CryptoJS: intercept AES.decrypt — the videasy player decrypts its source API
    // response here. We capture the plaintext before it ever reaches JSON.parse.
    if (window.CryptoJS && window.CryptoJS.AES && !window.CryptoJS.__movCliPatched) {
      window.CryptoJS.__movCliPatched = true;
      const _CJS = window.CryptoJS;
      const _origDecrypt = _CJS.AES.decrypt.bind(_CJS.AES);
      _CJS.AES.decrypt = function(ciphertext, key, opts) {
        const result = _origDecrypt(ciphertext, key, opts);
        try {
          const str = result.toString(_CJS.enc.Utf8);
          if (str && str.length > 2) {
            window.__decryptedPayloads.push(str);
            __tryParseJson(str);
          }
        } catch(e) {}
        return result;
      };
    }
  }
  __patchLibs();
  const __libTimer = setInterval(__patchLibs, 100);
  setTimeout(function() { clearInterval(__libTimer); }, 30000);
`;

/**
 * Apply JS-level stream interception + lightweight network capture.
 * No adblocker — essential for sites like videasy whose own API endpoints
 * get false-positived by filter lists.
 */
export async function applyLightCapture(page: Page, streamSink: string[]): Promise<void> {
  // Inject BEFORE any page JS runs.
  await page.addInitScript({ content: CAPTURE_INIT_SCRIPT });

  page.on("popup", (popup) => {
    logger.debug("Closing popup:", popup.url());
    popup.close().catch(() => {});
  });

  // Network-level capture as a belt-and-suspenders fallback.
  page.on("request", (req) => {
    const url = req.url();
    if (isStreamUrl(url)) {
      logger.debug("Captured stream request:", url);
      if (!streamSink.includes(url)) streamSink.push(url);
    }
  });
}

/**
 * Read stream URLs captured by the JS-level hooks (fetch/XHR/JSON.parse
 * patches injected via addInitScript).
 */
export async function readCapturedStreams(page: Page): Promise<string[]> {
  try {
    const streams = await page.evaluate(`window.__capturedStreams || []`) as string[];
    return streams;
  } catch {
    return [];
  }
}

/**
 * Read structured source objects captured from decrypted JSON payloads.
 * These come from intercepting JSON.parse on the videasy player's decrypted
 * API responses, giving us URL + quality before HLS.js turns them into blobs.
 */
export async function readCapturedSources(page: Page): Promise<Array<{ url: string; quality: string }>> {
  try {
    return await page.evaluate(`window.__capturedSources || []`) as Array<{ url: string; quality: string }>;
  } catch {
    return [];
  }
}

/**
 * Read raw decrypted text payloads captured from CryptoJS.AES.decrypt calls.
 * Useful for debugging when stream URLs can't be extracted automatically.
 */
export async function readDecryptedPayloads(page: Page): Promise<string[]> {
  try {
    return await page.evaluate(`window.__decryptedPayloads || []`) as string[];
  } catch {
    return [];
  }
}

/**
 * Read the raw response snippets captured from fetch() calls to relevant endpoints.
 */
export async function readRawResponses(page: Page): Promise<Array<{ url: string; snippet: string }>> {
  try {
    return await page.evaluate(`window.__rawResponses || []`) as Array<{ url: string; snippet: string }>;
  } catch {
    return [];
  }
}

/**
 * Extract video source URLs directly from the DOM's <video> and <source>
 * elements.
 */
export async function extractVideoSrcFromDom(page: Page): Promise<string[]> {
  try {
    return await page.evaluate(`
      (() => {
        const urls = [];
        for (const v of document.querySelectorAll("video")) {
          if (v.src && !v.src.startsWith("blob:")) urls.push(v.src);
          if (v.currentSrc && !v.currentSrc.startsWith("blob:")) urls.push(v.currentSrc);
          for (const s of v.querySelectorAll("source")) {
            if (s.src) urls.push(s.src);
          }
        }
        for (const f of document.querySelectorAll("iframe")) {
          try {
            const fd = f.contentDocument;
            if (!fd) continue;
            for (const v of fd.querySelectorAll("video")) {
              if (v.src && !v.src.startsWith("blob:")) urls.push(v.src);
              if (v.currentSrc && !v.currentSrc.startsWith("blob:")) urls.push(v.currentSrc);
            }
          } catch (e) { /* cross-origin */ }
        }
        return [...new Set(urls)];
      })()
    `) as string[];
  } catch (err) {
    logger.debug("extractVideoSrcFromDom failed:", err);
    return [];
  }
}
