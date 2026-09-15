import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { radius } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';

interface StoneSwatchProps {
  color: string;
  /** Square side length. */
  size?: number;
  label?: string;
  style?: ViewStyle;
}

/**
 * Stands in for a stone photograph: a tinted block with a subtle vein pattern,
 * so the catalogue reads correctly before real imagery is wired up.
 */
export function StoneSwatch({ color, size = 72, label, style }: StoneSwatchProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.swatch,
        {
          backgroundColor: color,
          borderColor: colors.border,
          borderRadius: radius.md,
          height: size,
          width: size,
        },
        style,
      ]}
    >
      <View style={[styles.vein, styles.veinOne]} />
      <View style={[styles.vein, styles.veinTwo]} />
      {label ? (
        <Text variant="caption" weight="bold" style={styles.label}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  swatch: { borderWidth: StyleSheet.hairlineWidth * 2, justifyContent: 'flex-end', overflow: 'hidden' },
  vein: { backgroundColor: 'rgba(255,255,255,0.28)', position: 'absolute' },
  veinOne: { height: 2, left: -10, right: -10, top: '32%', transform: [{ rotate: '-12deg' }] },
  veinTwo: { height: 1, left: -10, right: -10, top: '63%', transform: [{ rotate: '8deg' }] },
  label: { color: '#1A1A1A', padding: 4 },
});
