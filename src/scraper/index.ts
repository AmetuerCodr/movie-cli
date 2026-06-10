import type { Provider, SearchResult, Stream } from "./types.js";
import { cinebyProvider } from "./cineby.js";
import { vidsrcProvider } from "./vidsrc.js";
import { logger } from "../utils/logger.js";

/** Registry of providers keyed by name. Order defines the fallback chain. */
const providers: Provider[] = [cinebyProvider, vidsrcProvider];

export function listProviders(): string[] {
  return providers.map((p) => p.name);
}

export function getProvider(name: string): Provider | null {
  return providers.find((p) => p.name === name) ?? null;
}

/**
 * Return the requested provider first, then the rest as fallbacks.
 */
export function providerChain(preferred: string): Provider[] {
  const primary = getProvider(preferred);
  if (!primary) {
    logger.warn(`Unknown provider "${preferred}", defaulting to ${providers[0]?.name}`);
    return [...providers];
  }
  return [primary, ...providers.filter((p) => p.name !== preferred)];
}

/**
 * Search the chain. The first provider to return results wins; the rest are
 * not queried (matching ani-cli's single-source-per-search behavior).
 */
export async function searchWithFallback(
  preferred: string,
  query: string,
): Promise<{ provider: Provider; results: SearchResult[] } | null> {
  for (const provider of providerChain(preferred)) {
    try {
      logger.debug(`Searching via ${provider.name}...`);
      const results = await provider.search(query);
      if (results.length > 0) {
        return { provider, results };
      }
      logger.debug(`${provider.name} returned no results`);
    } catch (err) {
      logger.debug(`${provider.name} search threw:`, err);
    }
  }
  return null;
}

/**
 * Get streams for a result, trying the owning provider first and then the
 * rest of the chain if it comes up empty.
 */
export async function getStreamsWithFallback(
  preferred: string,
  result: SearchResult,
): Promise<Stream[]> {
  // Always try the provider that produced the result first.
  const ordered = [
    result.provider,
    ...providerChain(preferred)
      .map((p) => p.name)
      .filter((n) => n !== result.provider),
  ];

  for (const name of ordered) {
    const provider = getProvider(name);
    if (!provider) continue;
    try {
      logger.debug(`Fetching streams via ${provider.name}...`);
      const streams = await provider.getStreams(result);
      if (streams.length > 0) return streams;
    } catch (err) {
      logger.debug(`${provider.name} getStreams threw:`, err);
    }
  }
  return [];
}
