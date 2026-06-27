// Edge function: resolve playable streams for a movie or episode.
//
// Stream extraction needs a real headless browser (the source player only
// reveals its .m3u8 after running JS + WASM/CryptoJS decryption), which cannot
// run in the Deno edge runtime. So this function forwards the request to the
// hosted Playwright extractor worker (see /extractor) and returns its result.
//
// It also rewrites each stream URL to go through our /proxy function so the
// player can fetch HLS with the correct Referer/User-Agent headers.
//
// Required env:
//   EXTRACTOR_URL     e.g. https://movie-extractor.fly.dev
//   EXTRACTOR_SECRET  shared bearer token the extractor checks
// Optional:
//   PUBLIC_FUNCTIONS_URL  base for building proxied URLs; defaults to this
//                         request's origin + /functions/v1
//
// Request (GET or POST):
//   ?id=ID&type=movie|series[&season=N&episode=N]
//
// Deploy: supabase functions deploy streams --no-verify-jwt

import { json, preflight } from "../_shared/cors.ts";
import type { Stream } from "../_shared/types.ts";

const EXTRACTOR_URL = Deno.env.get("EXTRACTOR_URL") ?? "";
const EXTRACTOR_SECRET = Deno.env.get("EXTRACTOR_SECRET") ?? "";

interface Params {
  id: string;
  type: "movie" | "series";
  season?: number;
  episode?: number;
}

async function readParams(req: Request): Promise<Params | null> {
  if (req.method === "POST") {
    const body = await req.json().catch(() => null);
    if (body?.id) {
      return {
        id: String(body.id),
        type: body.type === "series" ? "series" : "movie",
        season: body.season != null ? Number(body.season) : undefined,
        episode: body.episode != null ? Number(body.episode) : undefined,
      };
    }
  }
  const u = new URL(req.url).searchParams;
  const id = u.get("id");
  if (!id) return null;
  return {
    id,
    type: u.get("type") === "series" ? "series" : "movie",
    season: u.get("season") ? Number(u.get("season")) : undefined,
    episode: u.get("episode") ? Number(u.get("episode")) : undefined,
  };
}

/** Build the public base URL for sibling functions (for the proxy rewrite). */
function functionsBase(req: Request): string {
  const configured = Deno.env.get("PUBLIC_FUNCTIONS_URL");
  if (configured) return configured.replace(/\/$/, "");
  const u = new URL(req.url);
  // .../functions/v1/streams -> .../functions/v1
  const fnRoot = u.pathname.replace(/\/streams.*$/, "");
  return `${u.origin}${fnRoot}`;
}

function toProxied(stream: Stream, base: string): Stream {
  const params = new URLSearchParams({ url: stream.url });
  if (stream.referer) params.set("referer", stream.referer);
  return { ...stream, url: `${base}/proxy?${params.toString()}` };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (!EXTRACTOR_URL) {
    return json({ error: "EXTRACTOR_URL not configured" }, 500);
  }

  try {
    const params = await readParams(req);
    if (!params) return json({ error: "missing id" }, 400);

    const res = await fetch(`${EXTRACTOR_URL.replace(/\/$/, "")}/extract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${EXTRACTOR_SECRET}`,
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json({ error: `extractor ${res.status}`, detail: text }, 502);
    }

    const data = (await res.json()) as { streams?: Stream[] };
    const streams = data.streams ?? [];
    const base = functionsBase(req);
    return json({ streams: streams.map((s) => toProxied(s, base)) });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
