import React from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';

interface StatTileProps {
  label: string;
  value: string;
  caption?: string;
  color?: string;
}

/** Compact KPI tile used on the home, mine and affiliate dashboards. */
export function StatTile({ label, value, caption, color }: StatTileProps) {
  const { colors } = useTheme();
  const accent = color ?? colors.primary;

  return (
    <View
      style={[
        styles.tile,
        { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md },
      ]}
    >
      <View style={[styles.bar, { backgroundColor: accent }]} />
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="title" weight="bold" style={{ color: accent }}>
        {value}
      </Text>
      {caption ? (
        <Text variant="caption" tone="faint">
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexBasis: '48%',
    flexGrow: 1,
    gap: 2,
    overflow: 'hidden',
    padding: spacing.md,
  },
  bar: { height: 3, marginBottom: spacing.xs, width: 28 },
});
