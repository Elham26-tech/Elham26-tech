import React from 'react';
import { StyleSheet, View } from 'react-native';

import { radius } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

interface ProgressBarProps {
  /** 0 to 1. */
  value: number;
  color?: string;
  height?: number;
}

export function ProgressBar({ value, color, height = 8 }: ProgressBarProps) {
  const { colors, isRtl } = useTheme();
  const clamped = Math.max(0, Math.min(1, value));

  return (
    <View
      style={[styles.track, { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, height }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          borderRadius: radius.pill,
          backgroundColor: color ?? colors.primary,
          alignSelf: isRtl ? 'flex-end' : 'flex-start',
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { overflow: 'hidden', width: '100%' },
});
