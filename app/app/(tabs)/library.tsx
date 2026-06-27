import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Title } from "@/api/types";
import { Rail } from "@/components/Rail";
import { Screen } from "@/components/Screen";
import { continueWatching, useLibrary } from "@/storage/library";
import { colors, font, spacing } from "@/theme";

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const library = useLibrary();

  const cw = continueWatching();
  const cwItems = cw.map((p) => p.title);
  const cwMeta = (t: Title) => {
    const entry = cw.find((p) => p.title.id === t.id);
    if (!entry) return undefined;
    const frac = entry.duration > 0 ? entry.position / entry.duration : 0;
    const sub = entry.season != null ? `S${entry.season} · E${entry.episode}` : undefined;
    return { progress: frac, subtitle: sub };
  };

  // De-duplicate history into a "Recently Watched" rail.
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out: Title[] = [];
    for (const h of library.history) {
      if (seen.has(h.title.id)) continue;
      seen.add(h.title.id);
      out.push(h.title);
    }
    return out;
  }, [library.history]);

  const isEmpty =
    library.favorites.length === 0 && cwItems.length === 0 && recent.length === 0;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.lg,
          paddingBottom: insets.bottom + 90,
        }}
      >
        <Text style={styles.header}>Library</Text>

        {isEmpty ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Nothing here yet.</Text>
            <Text style={styles.emptyHint}>
              Favorite titles and they'll show up here, along with anything you're
              part-way through.
            </Text>
          </View>
        ) : (
          <>
            {cwItems.length > 0 ? (
              <Rail
                title="Continue Watching"
                items={cwItems}
                posterWidth={150}
                metaFor={cwMeta}
              />
            ) : null}
            {library.favorites.length > 0 ? (
              <Rail title="Favorites" items={library.favorites} />
            ) : null}
            {recent.length > 0 ? <Rail title="Recently Watched" items={recent} /> : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    color: colors.text,
    fontSize: font.h1,
    fontWeight: "800",
    letterSpacing: -0.5,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  empty: { paddingHorizontal: spacing.xl, paddingTop: 80, alignItems: "center" },
  emptyText: { color: colors.text, fontSize: font.h3, fontWeight: "700" },
  emptyHint: {
    color: colors.textFaint,
    fontSize: font.body,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 21,
  },
});
