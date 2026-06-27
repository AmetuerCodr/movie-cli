// Wire types shared between the edge functions and the Expo app. Keep this in
// sync with app/src/api/types.ts (they are intentionally identical).

export interface Title {
  /** TMDB id as a string. */
  id: string;
  title: string;
  year: number | null;
  type: "movie" | "series";
  rating: number | null;
  poster: string | null;
  /** Which scraping provider should resolve streams for this title. */
  provider: string;
}

export interface Genre {
  id: number;
  name: string;
}

export interface SeasonSummary {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  poster: string | null;
}

export interface TitleDetails extends Title {
  overview: string;
  backdrop: string | null;
  genres: Genre[];
  runtime: number | null;
  seasons: SeasonSummary[];
  numberOfSeasons: number | null;
}

export interface Episode {
  episodeNumber: number;
  name: string;
  overview: string;
  still: string | null;
  airDate: string | null;
  runtime: number | null;
}

export interface Stream {
  url: string;
  quality: string;
  referer: string | null;
  isM3U8: boolean;
}

/** A single horizontal rail on the home screen. */
export interface Rail {
  key: string;
  title: string;
  items: Title[];
}
