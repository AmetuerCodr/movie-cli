// Edge function: HLS reverse-proxy.
//
// The stream CDN requires a specific Referer + User-Agent that the player
// cannot set on cross-origin media requests. This proxy fetches the upstream
// with the right headers, rewrites .m3u8 segment/variant URLs to route back
// through itself, and streams the response with permissive CORS.
//
// Usage: /functions/v1/proxy?url=<absolute>&referer=<origin>
//
// Deploy: supabase functions deploy proxy --no-verify-jwt

import { corsHeaders, preflight } from "../_shared/cors.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_REFERER = "https://player.videasy.to/";

/** Build a self-referential proxy URL for a (possibly relative) target. */
function proxify(self: URL, raw: string, base: URL, referer: string): string {
  const absolute = raw.startsWith("http") ? raw : new URL(raw, base).toString();
  const params = new URLSearchParams({ url: absolute, referer });
  return `${self.origin}${self.pathname}?${params.toString()}`;
}

function rewriteM3u8(content: string, self: URL, target: URL, referer: string): string {
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(
          /URI="([^"]+)"/g,
          (_m, uri: string) => `URI="${proxify(self, uri, target, referer)}"`,
        );
      }
      return proxify(self, trimmed, target, referer);
    })
    .join("\n");
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const self = new URL(req.url);
  const target = self.searchParams.get("url");
  const referer = self.searchParams.get("referer") ?? DEFAULT_REFERER;

  if (!target) {
    return new Response("missing url", { status: 400, headers: corsHeaders });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response("bad url", { status: 400, headers: corsHeaders });
  }

  try {
    const upstream = await fetch(targetUrl.toString(), {
      headers: {
        Referer: referer,
        Origin: new URL(referer).origin,
        "User-Agent": UA,
        Accept: "*/*",
        // Forward range requests so seeking works on plain mp4 segments.
        ...(req.headers.get("range") ? { Range: req.headers.get("range")! } : {}),
      },
    });

    const contentType =
      upstream.headers.get("content-type") ?? "application/octet-stream";
    const isM3U8 =
      targetUrl.pathname.includes(".m3u8") ||
      contentType.includes("mpegurl") ||
      contentType.includes("m3u8");

    if (isM3U8) {
      const text = await upstream.text();
      const rewritten = rewriteM3u8(text, self, targetUrl, referer);
      return new Response(rewritten, {
        status: upstream.status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
        },
      });
    }

    // Stream binary segments straight through.
    const headers = new Headers(corsHeaders);
    headers.set("Content-Type", contentType);
    const len = upstream.headers.get("content-length");
    if (len) headers.set("Content-Length", len);
    const range = upstream.headers.get("content-range");
    if (range) headers.set("Content-Range", range);
    headers.set("Cache-Control", "no-store");

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    return new Response(String(err), { status: 502, headers: corsHeaders });
  }
});
