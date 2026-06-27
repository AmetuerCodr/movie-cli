import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { loadLibrary } from "@/storage/library";
import { colors } from "@/theme";

export default function RootLayout() {
  useEffect(() => {
    void loadLibrary();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ThemeProvider value={DarkTheme}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: "fade",
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="title/[type]/[id]" options={{ presentation: "card" }} />
          <Stack.Screen
            name="player"
            options={{ presentation: "fullScreenModal", animation: "fade" }}
          />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
