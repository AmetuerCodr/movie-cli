// A titled horizontal carousel of posters — the building block of the Home
// and Library screens.

import { FlatList, StyleSheet, Text, View } from "react-native";
import type { Title } from "@/api/types";
import { colors, font, spacing } from "@/theme";
import { PosterCard } from "./PosterCard";

interface Props {
  title: string;
  items: Title[];
  posterWidth?: number;
  /** Optional per-item subtitle/progress, keyed by title id. */
  metaFor?: (t: Title) => { progress?: number; subtitle?: string } | undefined;
}

export function Rail({ title, items, posterWidth = 124, metaFor }: Props) {
  if (!items.length) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>{title}</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(t, i) => `${t.type}:${t.id}:${i}`}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        renderItem={({ item }) => {
          const meta = metaFor?.(item);
          return (
            <PosterCard
              title={item}
              width={posterWidth}
              progress={meta?.progress ?? 0}
              subtitle={meta?.subtitle}
            />
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.xl },
  heading: {
    color: colors.text,
    fontSize: font.h3,
    fontWeight: "700",
    letterSpacing: -0.2,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  row: { paddingHorizontal: spacing.lg },
});
