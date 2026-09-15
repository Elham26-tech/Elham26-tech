import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components';
import { useAuthStore } from '@/store/auth';
import { spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

/** Emoji tab glyphs keep the bundle free of an icon font while staying legible. */
const ICONS = {
  index: '🏠',
  market: '🛒',
  auction: '🔨',
  visualizer: '🪄',
  profile: '👤',
} as const;

function TabIcon({ name, focused }: { name: keyof typeof ICONS; focused: boolean }) {
  return (
    <View style={styles.icon}>
      <Text variant="title" style={{ opacity: focused ? 1 : 0.55 }}>
        {ICONS[name]}
      </Text>
    </View>
  );
}

export default function AppLayout() {
  const { colors, t } = useTheme();
  const token = useAuthStore((s) => s.token);
  const needsProfile = useAuthStore((s) => s.needsProfile);

  if (!token) return <Redirect href="/(auth)/phone" />;
  if (needsProfile) return <Redirect href="/(auth)/role" />;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 64,
          paddingBottom: spacing.sm,
          paddingTop: spacing.xs,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t.tabs.home,
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon name="index" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="market"
        options={{
          title: t.tabs.market,
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon name="market" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="auction"
        options={{
          title: t.tabs.auction,
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon name="auction" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="visualizer"
        options={{
          title: t.tabs.visualizer,
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon name="visualizer" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t.tabs.profile,
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon name="profile" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: { alignItems: 'center', justifyContent: 'center' },
});
