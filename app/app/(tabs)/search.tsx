import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/api/client";
import type { Title } from "@/api/types";
import { GlassView } from "@/components/GlassView";
import { PosterCard } from "@/components/PosterCard";
import { Screen } from "@/components/Screen";
import { colors, font, spacing } from "@/theme";

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Title[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { results } = await api.search(q);
        setResults(results);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
        setSearched(true);
      }
    }, 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  return (
    <Screen>
      <View style={{ paddingTop: insets.top + spacing.lg, flex: 1 }}>
        <View style={styles.searchWrap}>
          <GlassView rounded="pill" style={styles.searchBar}>
            <Ionicons name="search" size={18} color={colors.textDim} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Movies, series…"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => Keyboard.dismiss()}
            />
            {query.length > 0 ? (
              <Ionicons
                name="close-circle"
                size={18}
                color={colors.textFaint}
                onPress={() => setQuery("")}
              />
            ) : null}
          </GlassView>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xl }} />
        ) : (
          <FlatList
            data={results}
            keyExtractor={(t, i) => `${t.type}:${t.id}:${i}`}
            numColumns={3}
            columnWrapperStyle={styles.col}
            contentContainerStyle={{
              padding: spacing.lg,
              paddingBottom: insets.bottom + 90,
            }}
            renderItem={({ item }) => <PosterCard title={item} width={108} />}
            ListEmptyComponent={
              searched ? (
                <Text style={styles.empty}>No results for “{query.trim()}”.</Text>
              ) : (
                <Text style={styles.empty}>Search for something to watch.</Text>
              )
            }
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    height: 46,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: font.body,
    height: "100%",
  },
  col: { justifyContent: "space-between" },
  empty: {
    color: colors.textFaint,
    textAlign: "center",
    marginTop: 80,
    fontSize: font.body,
  },
});
