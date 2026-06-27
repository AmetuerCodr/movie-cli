// Liquid Glass design tokens — carried over from the original browser player
// (src/browser/proxy.ts): translucent dark glass surfaces, blurred backdrops,
// white text, SF-style type, soft shadows and inner highlights.

import { Platform } from "react-native";

export const colors = {
  bg: "#000000",
  // Glass surface fill (matches --glass: rgba(28,28,30,.72)).
  glass: "rgba(28,28,30,0.72)",
  glassStrong: "rgba(28,28,30,0.88)",
  glassBorder: "rgba(255,255,255,0.14)",
  glassHighlight: "rgba(255,255,255,0.12)",
  text: "#ffffff",
  textDim: "rgba(255,255,255,0.62)",
  textFaint: "rgba(255,255,255,0.40)",
  accent: "#ffffff",
  danger: "rgba(220,40,40,0.9)",
  rating: "#ffd60a",
} as const;

export const blur = {
  intensity: 40,
  // expo-blur tints: "dark" is closest to the player's glass.
  tint: "dark" as const,
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const font = {
  family: Platform.select({ ios: "System", default: "sans-serif" }),
  // Sizes tuned to the player's type scale.
  h1: 28,
  h2: 22,
  h3: 18,
  body: 15,
  small: 13,
  tiny: 11,
} as const;

export const shadow = {
  glass: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 12,
  },
} as const;

// Poster aspect ratio (TMDB posters are 2:3).
export const POSTER_RATIO = 2 / 3;
