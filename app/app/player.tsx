import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/api/client";
import type { Stream, Title } from "@/api/types";
import { GlassView } from "@/components/GlassView";
import { recordWatch, saveProgress } from "@/storage/library";
import { colors, font, radius, spacing } from "@/theme";

function fmt(s: number): string {
  s = Math.floor(s || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Pick the best stream: highest resolution, preferring HLS. */
function pickBest(streams: Stream[]): Stream | null {
  if (!streams.length) return null;
  const rank = (s: Stream) => {
    const m = s.quality.match(/(\d{3,4})/);
    return (m ? Number(m[1]) : 0) + (s.isM3U8 ? 1 : 0);
  };
  return [...streams].sort((a, b) => rank(b) - rank(a))[0];
}

export default function PlayerScreen() {
  const params = useLocalSearchParams<{
    id: string;
    type: "movie" | "series";
    title: string;
    poster?: string;
    provider?: string;
    year?: string;
    rating?: string;
    season?: string;
    episode?: string;
  }>();

  const season = params.season ? Number(params.season) : undefined;
  const episode = params.episode ? Number(params.episode) : undefined;

  const titleMeta: Title = useMemo(
    () => ({
      id: params.id,
      title: params.title,
      type: params.type,
      year: params.year ? Number(params.year) : null,
      rating: params.rating ? Number(params.rating) : null,
      poster: params.poster || null,
      provider: params.provider || "cineby",
    }),
    [params.id],
  );

  const [streams, setStreams] = useState<Stream[]>([]);
  const [selected, setSelected] = useState<Stream | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showQuality, setShowQuality] = useState(false);

  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 1;
  });

  // UI state mirrored from the player on an interval.
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barWidth = useRef(0);

  // ── Resolve streams ────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .streams({ id: params.id, type: params.type, season, episode })
      .then(({ streams }) => {
        if (!alive) return;
        if (!streams.length) {
          setError("No playable source found.");
          return;
        }
        setStreams(streams);
        setSelected(pickBest(streams));
        recordWatch(titleMeta, season, episode);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [params.id, season, episode]);

  // ── Swap the active source when selection changes ────────────────────────────
  useEffect(() => {
    if (!selected) return;
    player.replace({ uri: selected.url });
    player.play();
  }, [selected]);

  // ── Mirror player state ──────────────────────────────────────────────────────
  useEffect(() => {
    const tick = setInterval(() => {
      setPlaying(player.playing);
      setPosition(player.currentTime ?? 0);
      setDuration(player.duration ?? 0);
    }, 250);
    return () => clearInterval(tick);
  }, [player]);

  // ── Persist progress periodically and on unmount ─────────────────────────────
  useEffect(() => {
    const save = setInterval(() => {
      if (player.duration > 0) {
        saveProgress(titleMeta, player.currentTime, player.duration, season, episode);
      }
    }, 5000);
    return () => {
      clearInterval(save);
      if (player.duration > 0) {
        saveProgress(titleMeta, player.currentTime, player.duration, season, episode);
      }
    };
  }, [player, titleMeta, season, episode]);

  // ── Controls auto-hide ───────────────────────────────────────────────────────
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setControlsVisible(false), 3500);
  }, []);

  useEffect(() => {
    revealControls();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [revealControls]);

  const togglePlay = useCallback(() => {
    if (player.playing) player.pause();
    else player.play();
    revealControls();
  }, [player, revealControls]);

  const onScrub = useCallback(
    (x: number) => {
      if (!duration || !barWidth.current) return;
      const frac = Math.max(0, Math.min(1, x / barWidth.current));
      player.currentTime = frac * duration;
      setPosition(frac * duration);
    },
    [duration, player],
  );

  const scrubGesture = Gesture.Pan()
    .onBegin((e) => {
      revealControls();
      onScrub(e.x);
    })
    .onUpdate((e) => onScrub(e.x))
    .runOnJS(true);

  const pct = duration > 0 ? (position / duration) * 100 : 0;

  const subtitle =
    params.type === "series" && season != null ? `S${season} · E${episode}` : null;

  return (
    <View style={styles.root}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => (controlsVisible ? togglePlay() : revealControls())}>
        <VideoView
          style={StyleSheet.absoluteFill}
          player={player}
          contentFit="contain"
          nativeControls={false}
          allowsFullscreen
          allowsPictureInPicture
        />
      </Pressable>

      {/* Loading / error overlay */}
      {loading ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={colors.text} size="large" />
          <Text style={styles.loadingText}>Finding a stream…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => router.back()}>
            <Text style={styles.retryText}>Go back</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Chrome */}
      {controlsVisible && !loading && !error ? (
        <>
          {/* Top bar */}
          <LinearGradient
            colors={["rgba(0,0,0,0.7)", "transparent"]}
            style={styles.topBar}
            pointerEvents="box-none"
          >
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <GlassView rounded="pill" style={styles.roundBtn}>
                <Ionicons name="chevron-down" size={22} color={colors.text} />
              </GlassView>
            </Pressable>
            <View style={styles.topTitleWrap}>
              <Text style={styles.topTitle} numberOfLines={1}>
                {params.title}
              </Text>
              {subtitle ? <Text style={styles.topSub}>{subtitle}</Text> : null}
            </View>
            {streams.length > 1 ? (
              <Pressable onPress={() => setShowQuality((v) => !v)} hitSlop={12}>
                <GlassView rounded="pill" style={styles.roundBtn}>
                  <Ionicons name="settings-outline" size={20} color={colors.text} />
                </GlassView>
              </Pressable>
            ) : (
              <View style={styles.roundBtn} />
            )}
          </LinearGradient>

          {/* Quality menu */}
          {showQuality ? (
            <GlassView rounded="md" style={styles.qualityMenu}>
              {streams.map((s, i) => (
                <Pressable
                  key={`${s.url}:${i}`}
                  style={styles.qualityItem}
                  onPress={() => {
                    setSelected(s);
                    setShowQuality(false);
                  }}
                >
                  <Text style={styles.qualityText}>{s.quality || "auto"}</Text>
                  {selected?.url === s.url ? (
                    <Ionicons name="checkmark" size={16} color={colors.text} />
                  ) : null}
                </Pressable>
              ))}
            </GlassView>
          ) : null}

          {/* Bottom control pill */}
          <View style={styles.bottomWrap} pointerEvents="box-none">
            <GlassView rounded="lg" style={styles.pill}>
              <View style={styles.scrubRow}>
                <Text style={styles.time}>{fmt(position)}</Text>
                <GestureDetector gesture={scrubGesture}>
                  <View
                    style={styles.scrubWrap}
                    onLayout={(e: LayoutChangeEvent) => {
                      barWidth.current = e.nativeEvent.layout.width;
                    }}
                  >
                    <View style={styles.scrubTrack}>
                      <View style={[styles.scrubFill, { width: `${pct}%` }]} />
                    </View>
                  </View>
                </GestureDetector>
                <Text style={styles.time}>{fmt(duration)}</Text>
              </View>

              <View style={styles.btnRow}>
                <Pressable
                  style={styles.ctrl}
                  onPress={() => {
                    player.currentTime = Math.max(0, player.currentTime - 10);
                    revealControls();
                  }}
                >
                  <Ionicons name="play-back" size={24} color={colors.text} />
                </Pressable>
                <Pressable style={styles.ctrlMain} onPress={togglePlay}>
                  <Ionicons name={playing ? "pause" : "play"} size={30} color={colors.text} />
                </Pressable>
                <Pressable
                  style={styles.ctrl}
                  onPress={() => {
                    player.currentTime = Math.min(duration, player.currentTime + 10);
                    revealControls();
                  }}
                >
                  <Ionicons name="play-forward" size={24} color={colors.text} />
                </Pressable>
              </View>
            </GlassView>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  loadingText: { color: colors.textDim, fontSize: font.body },
  errorText: { color: colors.text, fontSize: font.h3, fontWeight: "600" },
  retry: {
    backgroundColor: colors.text,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  retryText: { color: "#000", fontWeight: "700" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 50,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  roundBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  topTitleWrap: { flex: 1 },
  topTitle: { color: colors.text, fontSize: font.h3, fontWeight: "700" },
  topSub: { color: colors.textDim, fontSize: font.small, marginTop: 2 },
  qualityMenu: { position: "absolute", top: 96, right: spacing.lg, minWidth: 130, padding: spacing.xs },
  qualityItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  qualityText: { color: colors.text, fontSize: font.body },
  bottomWrap: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  pill: { padding: spacing.lg },
  scrubRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  time: {
    color: colors.textDim,
    fontSize: font.tiny,
    fontWeight: "600",
    minWidth: 44,
    fontVariant: ["tabular-nums"],
  },
  scrubWrap: { flex: 1, height: 24, justifyContent: "center" },
  scrubTrack: {
    height: 4,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.22)",
    overflow: "hidden",
  },
  scrubFill: { height: "100%", backgroundColor: colors.text, borderRadius: 4 },
  btnRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxl,
    marginTop: spacing.md,
  },
  ctrl: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  ctrlMain: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
});
