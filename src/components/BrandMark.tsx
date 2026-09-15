import React from 'react';
import { StyleSheet, View } from 'react-native';

import { radius } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';

/** The app mark: a rounded tile carrying the AnbarSang initial. */
export function BrandMark({ size = 72 }: { size?: number }) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.mark,
        {
          backgroundColor: colors.primary,
          borderRadius: size * 0.28,
          height: size,
          width: size,
        },
      ]}
    >
      <View style={[styles.corner, { backgroundColor: colors.amber, borderTopLeftRadius: radius.sm }]} />
      <Text variant="display" weight="bold" tone="inverse" style={{ fontSize: size * 0.46 }}>
        س
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  corner: { bottom: 0, height: '38%', position: 'absolute', right: 0, width: '38%', opacity: 0.9 },
});
