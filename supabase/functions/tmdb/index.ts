// Edge function: TMDB browse / search / details surface.
//
// Routes (via ?action=):
//   home                                   -> curated rails for the Home screen
//   search&q=QUERY                         -> multi search
//   details&kind=movie|tv&id=ID            -> full title details + seasons
//   season&id=ID&season=N                  -> episodes for one season
//   genres                                 -> id->name genre dictionary
//   genre&kind=movie|tv&genreId=N          -> discover by genre
//   recommendations&kind=movie|tv&id=ID    -> TMDB recommendations seed
//
// Deploy: supabase functions deploy tmdb --no-verify-jwt

import { json, preflight } from "../_shared/cors.ts";
import * as tmdb from "../_shared/tmdb.ts";
import type { Rail } from "../_shared/types.ts";

// Genre rails surfaced on Home, by TMDB genre id.
const HOME_GENRES: Array<{ id: number; name: string; kind: "movie" | "tv" }> = [
  { id: 28, name: "Action", kind: "movie" },
  { id: 35, name: "Comedy", kind: "movie" },
  { id: 27, name: "Horror", kind: "movie" },
  { id: 878, name: "Sci-Fi", kind: "movie" },
  { id: 10749, name: "Romance", kind: "movie" },
  { id: 16, name: "Animation", kind: "movie" },
];

async function buildHome(): Promise<Rail[]> {
  const [trendingAll, popularMovies, popularTv, topRated, ...genreRails] =
    await Promise.all([
      tmdb.trending("all", "week"),
      tmdb.list("movie", "popular"),
      tmdb.list("tv", "popular"),
      tmdb.list("movie", "top_rated"),
      ...HOME_GENRES.map((g) => tmdb.discover(g.kind, g.id)),
    ]);

  const rails: Rail[] = [
    { key: "trending", title: "Trending This Week", items: trendingAll },
    { key: "popular-movies", title: "Popular Movies", items: popularMovies },
    { key: "popular-tv", title: "Popular Series", items: popularTv },
    { key: "top-rated", title: "Top Rated", items: topRated },
  ];
  HOME_GENRES.forEach((g, i) => {
    const items = genreRails[i] ?? [];
    if (items.length) rails.push({ key: `genre-${g.id}`, title: g.name, items });
  });
  return rails.filter((r) => r.items.length > 0);
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "home";
    const p = url.searchParams;

    switch (action) {
      case "home":
        return json({ rails: await buildHome() });

      case "search": {
        const q = p.get("q")?.trim();
        if (!q) return json({ results: [] });
        return json({ results: await tmdb.search(q) });
      }

      case "details": {
        const kind = (p.get("kind") ?? "movie") as "movie" | "tv";
        const id = p.get("id");
        if (!id) return json({ error: "missing id" }, 400);
        const d = await tmdb.details(kind, id);
        return d ? json(d) : json({ error: "not found" }, 404);
      }

      case "season": {
        const id = p.get("id");
        const season = Number(p.get("season") ?? "1");
        if (!id) return json({ error: "missing id" }, 400);
        return json({ episodes: await tmdb.seasonEpisodes(id, season) });
      }

      case "genres":
        return json({ genres: await tmdb.genres() });

      case "genre": {
        const kind = (p.get("kind") ?? "movie") as "movie" | "tv";
        const genreId = Number(p.get("genreId"));
        if (!genreId) return json({ error: "missing genreId" }, 400);
        const page = Number(p.get("page") ?? "1");
        return json({ results: await tmdb.discover(kind, genreId, page) });
      }

      case "recommendations": {
        const kind = (p.get("kind") ?? "movie") as "movie" | "tv";
        const id = p.get("id");
        if (!id) return json({ error: "missing id" }, 400);
        return json({ results: await tmdb.recommendations(kind, id) });
      }

      default:
        return json({ error: `unknown action "${action}"` }, 400);
    }
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
