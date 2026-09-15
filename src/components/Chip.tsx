import React from 'react';
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
  style?: ViewStyle;
}

/** Selectable pill used for categories, filters and visualizer options. */
export function Chip({ label, selected, onPress, color, style }: ChipProps) {
  const { colors } = useTheme();
  const accent = color ?? colors.primary;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ selected: Boolean(selected) }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? accent : colors.surfaceAlt,
          borderColor: selected ? accent : colors.border,
          borderRadius: radius.pill,
          opacity: pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      <Text variant="small" weight="medium" tone={selected ? 'inverse' : 'muted'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
});
