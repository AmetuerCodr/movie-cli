import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/api/client";
import type { Rail as RailData, Title } from "@/api/types";
import { Rail } from "@/components/Rail";
import { Screen } from "@/components/Screen";
import { buildForYou } from "@/recommend";
import { continueWatching, useLibrary } from "@/storage/library";
import { colors, font, spacing } from "@/theme";

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const library = useLibrary();
  const [rails, setRails] = useState<RailData[]>([]);
  const [forYou, setForYou] = useState<Title[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [home, fy] = await Promise.all([
        api.home(),
        buildForYou(library.favorites, library.history),
      ]);
      setRails(home.rails);
      setForYou(fy);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Continue-watching rail from local progress.
  const cw = continueWatching();
  const cwItems = useMemo(() => cw.map((p) => p.title), [library.progress]);
  const cwMeta = (t: Title) => {
    const entry = cw.find((p) => p.title.id === t.id);
    if (!entry) return undefined;
    const frac = entry.duration > 0 ? entry.position / entry.duration : 0;
    const sub =
      entry.season != null ? `S${entry.season} · E${entry.episode}` : undefined;
    return { progress: frac, subtitle: sub };
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.lg,
          paddingBottom: insets.bottom + 90,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.text}
          />
        }
      >
        <Text style={styles.header}>Watch</Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.error}>{error}</Text>
            <Text style={styles.errorHint}>
              Check EXPO_PUBLIC_API_BASE in app/.env
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
            {forYou.length > 0 ? <Rail title="For You" items={forYou} /> : null}
            {rails.map((r) => (
              <Rail key={r.key} title={r.title} items={r.items} />
            ))}
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
  center: { paddingVertical: 80, alignItems: "center" },
  error: { color: colors.text, fontSize: font.body },
  errorHint: { color: colors.textFaint, fontSize: font.small, marginTop: spacing.sm },
});
