import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/api/client";
import type { Episode, Title, TitleDetails } from "@/api/types";
import { GlassView } from "@/components/GlassView";
import { Rail } from "@/components/Rail";
import { getProgress, isFavorite, toggleFavorite, useLibrary } from "@/storage/library";
import { colors, font, radius, spacing } from "@/theme";

export default function DetailScreen() {
  const { type, id } = useLocalSearchParams<{ type: "movie" | "series"; id: string }>();
  const insets = useSafeAreaInsets();
  useLibrary(); // re-render on favorite changes

  const [details, setDetails] = useState<TitleDetails | null>(null);
  const [recs, setRecs] = useState<Title[]>([]);
  const [season, setSeason] = useState(1);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [epLoading, setEpLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api.details(type, id);
        if (!alive) return;
        setDetails(d);
        if (d.seasons.length) setSeason(d.seasons[0].seasonNumber);
        api
          .recommendations(type, id)
          .then((r) => alive && setRecs(r.results))
          .catch(() => {});
      } catch {
        // leave details null -> error state
      }
    })();
    return () => {
      alive = false;
    };
  }, [type, id]);

  // Load episodes when the selected season changes (series only).
  useEffect(() => {
    if (type !== "series" || !details) return;
    let alive = true;
    setEpLoading(true);
    api
      .season(id, season)
      .then((r) => alive && setEpisodes(r.episodes))
      .catch(() => alive && setEpisodes([]))
      .finally(() => alive && setEpLoading(false));
    return () => {
      alive = false;
    };
  }, [type, id, season, details]);

  if (!details) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  const titleMeta: Title = {
    id: details.id,
    title: details.title,
    year: details.year,
    type: details.type,
    rating: details.rating,
    poster: details.poster,
    provider: details.provider,
  };

  const fav = isFavorite(details.id);

  function play(opts?: { season?: number; episode?: number }) {
    router.push({
      pathname: "/player",
      params: {
        id: details!.id,
        type: details!.type,
        title: details!.title,
        poster: details!.poster ?? "",
        provider: details!.provider,
        year: String(details!.year ?? ""),
        rating: String(details!.rating ?? ""),
        ...(opts?.season != null ? { season: String(opts.season) } : {}),
        ...(opts?.episode != null ? { episode: String(opts.episode) } : {}),
      },
    });
  }

  const movieProgress = type === "movie" ? getProgress("movie", details.id) : null;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}>
        {/* Hero */}
        <View style={styles.hero}>
          {details.backdrop ? (
            <Image source={{ uri: details.backdrop }} style={styles.backdrop} />
          ) : (
            <View style={[styles.backdrop, { backgroundColor: "#15171f" }]} />
          )}
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.6)", colors.bg]}
            style={StyleSheet.absoluteFill}
          />
          <Pressable
            style={[styles.back, { top: insets.top + spacing.sm }]}
            onPress={() => router.back()}
            hitSlop={12}
          >
            <GlassView rounded="pill" style={styles.backInner}>
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </GlassView>
          </Pressable>
        </View>

        <View style={styles.body}>
          <Text style={styles.title}>{details.title}</Text>
          <View style={styles.metaRow}>
            {details.year ? <Text style={styles.meta}>{details.year}</Text> : null}
            {details.rating ? (
              <Text style={styles.meta}>★ {details.rating.toFixed(1)}</Text>
            ) : null}
            {details.runtime ? <Text style={styles.meta}>{details.runtime}m</Text> : null}
            <Text style={[styles.meta, styles.typeTag]}>
              {details.type === "series" ? "Series" : "Movie"}
            </Text>
          </View>

          {details.genres.length > 0 ? (
            <Text style={styles.genres}>{details.genres.map((g) => g.name).join(" · ")}</Text>
          ) : null}

          {/* Actions */}
          <View style={styles.actions}>
            {type === "movie" ? (
              <Pressable style={styles.playBtn} onPress={() => play()}>
                <Ionicons name="play" size={20} color="#000" />
                <Text style={styles.playText}>
                  {movieProgress ? "Resume" : "Play"}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                style={styles.playBtn}
                onPress={() => play({ season, episode: 1 })}
              >
                <Ionicons name="play" size={20} color="#000" />
                <Text style={styles.playText}>Play S{season} · E1</Text>
              </Pressable>
            )}
            <Pressable style={styles.iconBtn} onPress={() => toggleFavorite(titleMeta)}>
              <GlassView rounded="pill" style={styles.iconBtnInner}>
                <Ionicons
                  name={fav ? "heart" : "heart-outline"}
                  size={22}
                  color={fav ? colors.danger : colors.text}
                />
              </GlassView>
            </Pressable>
          </View>

          {details.overview ? (
            <Text style={styles.overview}>{details.overview}</Text>
          ) : null}

          {/* Series: season picker + episodes */}
          {type === "series" && details.seasons.length > 0 ? (
            <View style={styles.seasonSection}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.seasonRow}
              >
                {details.seasons.map((s) => {
                  const active = s.seasonNumber === season;
                  return (
                    <Pressable
                      key={s.seasonNumber}
                      onPress={() => setSeason(s.seasonNumber)}
                      style={[styles.seasonPill, active && styles.seasonPillActive]}
                    >
                      <Text style={[styles.seasonText, active && styles.seasonTextActive]}>
                        {s.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {epLoading ? (
                <ActivityIndicator color={colors.text} style={{ marginTop: spacing.lg }} />
              ) : (
                episodes.map((ep) => {
                  const prog = getProgress("series", details.id, season, ep.episodeNumber);
                  const frac = prog && prog.duration > 0 ? prog.position / prog.duration : 0;
                  return (
                    <Pressable
                      key={ep.episodeNumber}
                      style={styles.episode}
                      onPress={() => play({ season, episode: ep.episodeNumber })}
                    >
                      <View style={styles.epStillWrap}>
                        {ep.still ? (
                          <Image source={{ uri: ep.still }} style={styles.epStill} />
                        ) : (
                          <View style={[styles.epStill, { backgroundColor: "#1c1f29" }]} />
                        )}
                        <View style={styles.epPlay}>
                          <Ionicons name="play" size={16} color={colors.text} />
                        </View>
                        {frac > 0 ? (
                          <View style={styles.epProgressTrack}>
                            <View style={[styles.epProgressFill, { width: `${frac * 100}%` }]} />
                          </View>
                        ) : null}
                      </View>
                      <View style={styles.epInfo}>
                        <Text style={styles.epTitle} numberOfLines={1}>
                          {ep.episodeNumber}. {ep.name}
                        </Text>
                        {ep.overview ? (
                          <Text style={styles.epOverview} numberOfLines={2}>
                            {ep.overview}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </View>
          ) : null}
        </View>

        {recs.length > 0 ? (
          <View style={{ marginTop: spacing.lg }}>
            <Rail title="More Like This" items={recs} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  hero: { height: 320, width: "100%" },
  backdrop: { width: "100%", height: "100%" },
  back: { position: "absolute", left: spacing.lg },
  backInner: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: spacing.lg, marginTop: -spacing.xxl },
  title: { color: colors.text, fontSize: font.h1, fontWeight: "800", letterSpacing: -0.5 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm },
  meta: { color: colors.textDim, fontSize: font.small, fontWeight: "600" },
  typeTag: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: "hidden",
  },
  genres: { color: colors.textFaint, fontSize: font.small, marginTop: spacing.sm },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.lg },
  playBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.text,
    borderRadius: radius.pill,
    height: 50,
  },
  playText: { color: "#000", fontSize: font.h3, fontWeight: "700" },
  iconBtn: {},
  iconBtnInner: { width: 50, height: 50, alignItems: "center", justifyContent: "center" },
  overview: { color: colors.textDim, fontSize: font.body, lineHeight: 22, marginTop: spacing.lg },
  seasonSection: { marginTop: spacing.xl },
  seasonRow: { gap: spacing.sm, paddingVertical: spacing.xs, marginBottom: spacing.md },
  seasonPill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
  },
  seasonPillActive: { backgroundColor: colors.text, borderColor: colors.text },
  seasonText: { color: colors.text, fontSize: font.small, fontWeight: "600" },
  seasonTextActive: { color: "#000" },
  episode: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  epStillWrap: { width: 140, height: 79, borderRadius: radius.sm, overflow: "hidden" },
  epStill: { width: "100%", height: "100%" },
  epPlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  epProgressTrack: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  epProgressFill: { height: "100%", backgroundColor: colors.accent },
  epInfo: { flex: 1, justifyContent: "center" },
  epTitle: { color: colors.text, fontSize: font.body, fontWeight: "600" },
  epOverview: { color: colors.textFaint, fontSize: font.small, marginTop: 3, lineHeight: 18 },
});
