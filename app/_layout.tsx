import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { useAuthStore } from '@/store/auth';
import { useSettingsStore } from '@/store/settings';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const hydrateAuth = useAuthStore((s) => s.hydrate);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const authReady = useAuthStore((s) => s.hydrated);
  const settingsReady = useSettingsStore((s) => s.hydrated);

  useEffect(() => {
    void hydrateSettings();
    void hydrateAuth();
  }, [hydrateAuth, hydrateSettings]);

  const ready = authReady && settingsReady;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>{ready ? <RootNavigator /> : <BootScreen />}</ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function BootScreen() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

function RootNavigator() {
  const { colors, mode, t } = useTheme();

  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="mine/index" options={{ title: t.mine.title }} />
        <Stack.Screen name="logistics/index" options={{ title: t.logistics.title }} />
        <Stack.Screen name="logistics/[id]" options={{ title: t.logistics.shipments }} />
        <Stack.Screen name="trade/index" options={{ title: t.trade.title }} />
        <Stack.Screen name="trade/rfq" options={{ title: t.trade.newRfq }} />
        <Stack.Screen name="trade/guide" options={{ title: t.trade.exportGuide }} />
        <Stack.Screen name="affiliate/index" options={{ title: t.affiliate.title }} />
        <Stack.Screen name="tour/[id]" options={{ title: t.logistics.virtualTour }} />
      </Stack>
    </>
  );
}
