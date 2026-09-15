import React from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  contentStyle?: ViewStyle;
  /** Extra bottom padding so content clears a floating action bar. */
  bottomInset?: number;
}

/** Page shell: themed background, safe-area padding and optional scrolling. */
export function Screen({ children, scroll = true, padded = true, contentStyle, bottomInset = 0 }: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const content: ViewStyle = {
    padding: padded ? spacing.lg : 0,
    paddingBottom: spacing.xxl + bottomInset + insets.bottom,
  };

  if (!scroll) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }, content, contentStyle]}>
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: colors.background }]}
      contentContainerStyle={[content, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
