import type { Stream } from "../types.js";
import { streamtapeExtractor } from "./streamtape.js";
import { mixdropExtractor } from "./mixdrop.js";
import { doodstreamExtractor } from "./doodstream.js";

export interface Extractor {
  name: string;
  /** Returns true if this extractor can handle the given embed URL host. */
  canHandle(url: string): boolean;
  /** Resolve an embed/host URL into one or more playable streams. */
  extract(url: string): Promise<Stream[]>;
}

const extractors: Extractor[] = [
  streamtapeExtractor,
  mixdropExtractor,
  doodstreamExtractor,
];

export function findExtractor(url: string): Extractor | null {
  return extractors.find((e) => e.canHandle(url)) ?? null;
}

export function listExtractors(): string[] {
  return extractors.map((e) => e.name);
}
