// Runtime configuration, read from EXPO_PUBLIC_* env vars (inlined at build
// time by Expo). Copy app/.env.example to app/.env and fill these in.

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "";
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!API_BASE) {
  // Surfaced once in the console to make misconfiguration obvious in dev.
  console.warn(
    "[config] EXPO_PUBLIC_API_BASE is not set — copy app/.env.example to app/.env",
  );
}

export const config = {
  apiBase: API_BASE.replace(/\/$/, ""),
  anonKey: ANON_KEY,
};
