// Liquid-glass surface: a blurred translucent panel with a hairline border and
// inner highlight, matching the original player's `--glass` pill. Falls back to
// a semi-opaque fill where blur isn't available.

import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { blur, colors, radius, shadow } from "@/theme";

interface Props {
  children?: ReactNode;
  style?: ViewStyle | ViewStyle[];
  intensity?: number;
  rounded?: keyof typeof radius;
  bordered?: boolean;
}

export function GlassView({
  children,
  style,
  intensity = blur.intensity,
  rounded = "lg",
  bordered = true,
}: Props) {
  return (
    <View style={[styles.shadow, { borderRadius: radius[rounded] }, style]}>
      <BlurView
        intensity={intensity}
        tint={blur.tint}
        style={[
          styles.inner,
          {
            borderRadius: radius[rounded],
            borderWidth: bordered ? StyleSheet.hairlineWidth : 0,
          },
        ]}
      >
        {children}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    ...shadow.glass,
  },
  inner: {
    overflow: "hidden",
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
  },
});
