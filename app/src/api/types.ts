// Wire types — kept identical to supabase/functions/_shared/types.ts.

export interface Title {
  id: string;
  title: string;
  year: number | null;
  type: "movie" | "series";
  rating: number | null;
  poster: string | null;
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

export interface Rail {
  key: string;
  title: string;
  items: Title[];
}
