// Device-local library: favorites, watch history, and playback progress
// (continue-watching). Backed by AsyncStorage with an in-memory cache and a
// tiny pub/sub so React views re-render on change. No accounts, no server.
//
// Structured so it can later be swapped for / mirrored to Supabase Postgres
// without touching the screens (they only use the exported hooks/actions).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import type { Title } from "@/api/types";

export interface Progress {
  /** Seconds watched. */
  position: number;
  /** Total duration in seconds (0 if unknown). */
  duration: number;
  updatedAt: number;
  /** For series. */
  season?: number;
  episode?: number;
}

export interface HistoryEntry {
  title: Title;
  watchedAt: number;
  season?: number;
  episode?: number;
}

interface LibraryState {
  favorites: Title[];
  history: HistoryEntry[];
  // Keyed by progressKey().
  progress: Record<string, Progress & { title: Title }>;
}

const KEY = "movieapp.library.v1";
const MAX_HISTORY = 100;

const empty: LibraryState = { favorites: [], history: [], progress: {} };

let state: LibraryState = empty;
let loaded = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // best-effort; ignore write failures
  }
}

function setState(next: LibraryState): void {
  state = next;
  emit();
  void persist();
}

/** Load persisted state once at app start. */
export async function loadLibrary(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LibraryState>;
      state = {
        favorites: parsed.favorites ?? [],
        history: parsed.history ?? [],
        progress: parsed.progress ?? {},
      };
      emit();
    }
  } catch {
    state = empty;
  }
}

export function progressKey(
  type: "movie" | "series",
  id: string,
  season?: number,
  episode?: number,
): string {
  return type === "series" ? `series:${id}:${season ?? 1}:${episode ?? 1}` : `movie:${id}`;
}

// ── Actions ────────────────────────────────────────────────────────────────

export function isFavorite(id: string): boolean {
  return state.favorites.some((t) => t.id === id);
}

export function toggleFavorite(title: Title): void {
  const exists = isFavorite(title.id);
  setState({
    ...state,
    favorites: exists
      ? state.favorites.filter((t) => t.id !== title.id)
      : [title, ...state.favorites],
  });
}

export function recordWatch(title: Title, season?: number, episode?: number): void {
  const entry: HistoryEntry = { title, watchedAt: Date.now(), season, episode };
  const deduped = state.history.filter(
    (h) => !(h.title.id === title.id && h.season === season && h.episode === episode),
  );
  setState({ ...state, history: [entry, ...deduped].slice(0, MAX_HISTORY) });
}

export function saveProgress(
  title: Title,
  position: number,
  duration: number,
  season?: number,
  episode?: number,
): void {
  // Ignore trivial progress (intro skip / accidental opens).
  if (position < 5) return;
  const key = progressKey(title.type, title.id, season, episode);
  // Drop near-complete items from continue-watching.
  const next = { ...state.progress };
  if (duration > 0 && position / duration > 0.95) {
    delete next[key];
  } else {
    next[key] = { position, duration, updatedAt: Date.now(), season, episode, title };
  }
  setState({ ...state, progress: next });
}

export function getProgress(
  type: "movie" | "series",
  id: string,
  season?: number,
  episode?: number,
): Progress | null {
  return state.progress[progressKey(type, id, season, episode)] ?? null;
}

export function clearProgress(key: string): void {
  if (!state.progress[key]) return;
  const next = { ...state.progress };
  delete next[key];
  setState({ ...state, progress: next });
}

/** Continue-watching list, most recent first. */
export function continueWatching(): Array<Progress & { title: Title; key: string }> {
  return Object.entries(state.progress)
    .map(([key, v]) => ({ ...v, key }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// ── React binding ────────────────────────────────────────────────────────────

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useLibrary(): LibraryState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}
