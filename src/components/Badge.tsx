import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';

interface BadgeProps {
  label: string;
  color?: string;
  /** Draws a filled dot before the label — used for the live-auction indicator. */
  dot?: boolean;
  style?: ViewStyle;
}

export function Badge({ label, color, dot, style }: BadgeProps) {
  const { colors, isRtl } = useTheme();
  const accent = color ?? colors.primary;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: `${accent}22`,
          borderColor: `${accent}55`,
          borderRadius: radius.pill,
          flexDirection: isRtl ? 'row-reverse' : 'row',
        },
        style,
      ]}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: accent }]} /> : null}
      <Text variant="caption" weight="bold" style={{ color: accent }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
  },
  dot: { borderRadius: 4, height: 7, width: 7 },
});
