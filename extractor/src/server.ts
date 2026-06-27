/**
 * Hosted stream-extraction worker.
 *
 * Stream extraction needs a real headless browser, which can't run in a
 * Supabase Edge Function. This tiny HTTP service wraps the existing Playwright
 * scraper so it can run in a cloud container the app reaches indirectly (the
 * `streams` edge function calls it). It is host-agnostic: it binds to $PORT
 * (default 7860, which Hugging Face Spaces expects) on 0.0.0.0.
 *
 * Endpoints:
 *   GET  /health            -> { ok: true }
 *   POST /extract           -> { streams: Stream[] }
 *     body: { id, type: "movie"|"series", season?, episode?, provider? }
 *
 * Auth: if EXTRACTOR_SECRET is set, /extract requires
 *   Authorization: Bearer <EXTRACTOR_SECRET>
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { browserManager } from "../../src/browser/index.js";
import { getStreamsWithFallback } from "../../src/scraper/index.js";
import type { SearchResult, Stream } from "../../src/scraper/types.js";

const PORT = Number(process.env.PORT ?? 7860);
const SECRET = process.env.EXTRACTOR_SECRET ?? "";
const DEFAULT_PROVIDER = process.env.STREAM_PROVIDER ?? "cineby";

let browserReady: Promise<void> | null = null;
function ensureBrowser(): Promise<void> {
  if (!browserReady) browserReady = browserManager.init(true);
  return browserReady;
}

interface ExtractBody {
  id?: string | number;
  type?: string;
  season?: number;
  episode?: number;
  provider?: string;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function authorized(req: IncomingMessage): boolean {
  if (!SECRET) return true; // open if no secret configured (dev)
  const header = req.headers["authorization"] ?? "";
  return header === `Bearer ${SECRET}`;
}

async function handleExtract(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authorized(req)) {
    send(res, 401, { error: "unauthorized" });
    return;
  }

  let body: ExtractBody;
  try {
    body = JSON.parse(await readBody(req)) as ExtractBody;
  } catch {
    send(res, 400, { error: "invalid json body" });
    return;
  }

  if (body.id == null) {
    send(res, 400, { error: "missing id" });
    return;
  }

  const provider = body.provider ?? DEFAULT_PROVIDER;
  const result: SearchResult = {
    id: String(body.id),
    title: "",
    year: null,
    type: body.type === "series" ? "series" : "movie",
    rating: null,
    poster: null,
    provider,
    season: body.season != null ? Number(body.season) : undefined,
    episode: body.episode != null ? Number(body.episode) : undefined,
  };

  try {
    await ensureBrowser();
    const streams: Stream[] = await getStreamsWithFallback(provider, result);
    send(res, 200, { streams });
  } catch (err) {
    send(res, 500, { error: String(err) });
  }
}

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (req.method === "GET" && (url === "/health" || url === "/")) {
    send(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && url.startsWith("/extract")) {
    void handleExtract(req, res);
    return;
  }
  send(res, 404, { error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`extractor listening on :${PORT}`);
});
