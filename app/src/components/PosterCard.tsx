// A tappable poster with title/rating overlay and an optional progress bar
// (used by continue-watching). Navigates to the title detail screen.

import { Link } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Title } from "@/api/types";
import { colors, font, radius, spacing } from "@/theme";

interface Props {
  title: Title;
  width?: number;
  /** 0..1 watched fraction; renders a bottom progress bar when > 0. */
  progress?: number;
  subtitle?: string;
}

export function PosterCard({ title, width = 124, progress = 0, subtitle }: Props) {
  const height = width * 1.5;
  return (
    <Link href={`/title/${title.type}/${title.id}`} asChild>
      <Pressable style={[styles.wrap, { width }]}>
        <View style={[styles.posterBox, { width, height }]}>
          {title.poster ? (
            <Image source={{ uri: title.poster }} style={styles.poster} resizeMode="cover" />
          ) : (
            <View style={[styles.poster, styles.placeholder]}>
              <Text style={styles.placeholderText} numberOfLines={3}>
                {title.title}
              </Text>
            </View>
          )}
          {title.rating ? (
            <View style={styles.ratingPill}>
              <Text style={styles.ratingText}>{title.rating.toFixed(1)}</Text>
            </View>
          ) : null}
          {progress > 0 ? (
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.min(100, progress * 100)}%` }]} />
            </View>
          ) : null}
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {title.title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : title.year ? (
          <Text style={styles.subtitle}>{title.year}</Text>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  wrap: { marginRight: spacing.md },
  posterBox: {
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.glass,
  },
  poster: { width: "100%", height: "100%" },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.sm,
  },
  placeholderText: { color: colors.textDim, fontSize: font.small, textAlign: "center" },
  ratingPill: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  ratingText: { color: colors.rating, fontSize: font.tiny, fontWeight: "700" },
  progressTrack: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  progressFill: { height: "100%", backgroundColor: colors.accent },
  title: {
    color: colors.text,
    fontSize: font.small,
    fontWeight: "600",
    marginTop: spacing.sm,
  },
  subtitle: { color: colors.textFaint, fontSize: font.tiny, marginTop: 2 },
});
