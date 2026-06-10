export interface SearchResult {
  /** Provider-specific identifier (slug, tmdb id, or detail URL). */
  id: string;
  title: string;
  year: number | null;
  type: "movie" | "series";
  /** 0-10, or null when unknown. */
  rating: number | null;
  /** Poster image URL, or null. */
  poster: string | null;
  provider: string;
}

export interface Stream {
  url: string;
  /** "1080p", "720p", "480p", or "unknown". */
  quality: string;
  /** HTTP Referer header the player must send, or null. */
  referer: string | null;
  isM3U8: boolean;
}

export interface Provider {
  name: string;
  search(query: string): Promise<SearchResult[]>;
  getStreams(result: SearchResult): Promise<Stream[]>;
}

export interface PlayerConfig {
  name: string;
  bin: string;
  buildArgs(stream: Stream, title: string): string[];
}
