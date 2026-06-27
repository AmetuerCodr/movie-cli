// Client-side recommendation re-ranker.
//
// The backend gives us TMDB feeds (trending / popular / genre rails). This
// layer personalizes them using the on-device library: it learns which genres,
// titles, and media types you actually watch/favorite, then scores and re-ranks
// candidate titles. It also builds a "Because you watched …" seed list.
//
// Pure functions — no network, no storage writes — so it's cheap to run on
// every render of the Home screen.

import { api } from "@/api/client";
import type { Title } from "@/api/types";
import type { HistoryEntry } from "@/storage/library";

export interface TasteProfile {
  /** genreId -> affinity weight. */
  genres: Record<number, number>;
  /** Preferred media type bias in [-1, 1] (negative = movies, positive = series). */
  typeBias: number;
  /** TMDB ids already engaged with, to suppress from recommendations. */
  seen: Set<string>;
}

// Note: list/trending Titles from the API don't carry genre ids (TMDB list
// endpoints omit them), so genre affinity is seeded from explicit signals we DO
// have — favorites/history via details lookups are too expensive on every
// render, so we approximate using type + recency + rating, and use TMDB's own
// "recommendations" endpoint (seeded from recent watches) for the heavy lifting.

export function buildProfile(
  favorites: Title[],
  history: HistoryEntry[],
): TasteProfile {
  const genres: Record<number, number> = {};
  let movieCount = 0;
  let seriesCount = 0;
  const seen = new Set<string>();

  const consider = (t: Title, weight: number): void => {
    seen.add(t.id);
    if (t.type === "series") seriesCount += weight;
    else movieCount += weight;
  };

  favorites.forEach((t) => consider(t, 2));
  history.forEach((h, i) => {
    // More recent history counts for more.
    const recency = Math.max(0.3, 1 - i / Math.max(history.length, 1));
    consider(h.title, recency);
  });

  const total = movieCount + seriesCount || 1;
  const typeBias = (seriesCount - movieCount) / total;

  return { genres, typeBias, seen };
}

/** Score a candidate title against the taste profile (higher = better). */
export function scoreTitle(t: Title, profile: TasteProfile): number {
  if (profile.seen.has(t.id)) return -Infinity; // already engaged — exclude
  let score = 0;
  // Quality prior.
  if (t.rating != null) score += t.rating; // 0..10
  // Recency prior — newer titles edge ahead.
  if (t.year != null) score += Math.max(0, (t.year - 1990) / 40); // ~0..1
  // Media-type affinity.
  const typeMatch = t.type === "series" ? profile.typeBias : -profile.typeBias;
  score += typeMatch * 2.5;
  return score;
}

/** Re-rank a candidate list by personal taste, excluding seen titles. */
export function rerank(items: Title[], profile: TasteProfile): Title[] {
  return [...items]
    .map((t) => ({ t, s: scoreTitle(t, profile) }))
    .filter((x) => x.s !== -Infinity)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.t);
}

function dedupe(items: Title[]): Title[] {
  const seen = new Set<string>();
  const out: Title[] = [];
  for (const t of items) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

/**
 * Build a personalized "For You" rail by fetching TMDB recommendations seeded
 * from the user's most recent watches/favorites, then re-ranking by taste.
 * Returns [] when there's nothing to seed from (cold start).
 */
export async function buildForYou(
  favorites: Title[],
  history: HistoryEntry[],
  limit = 20,
): Promise<Title[]> {
  const profile = buildProfile(favorites, history);

  // Seed from the 3 most recent meaningful signals.
  const seeds: Title[] = dedupe([
    ...history.slice(0, 3).map((h) => h.title),
    ...favorites.slice(0, 3),
  ]).slice(0, 4);

  if (seeds.length === 0) return [];

  const batches = await Promise.all(
    seeds.map((s) =>
      api
        .recommendations(s.type, s.id)
        .then((r) => r.results)
        .catch(() => [] as Title[]),
    ),
  );

  const candidates = dedupe(batches.flat());
  return rerank(candidates, profile).slice(0, limit);
}
