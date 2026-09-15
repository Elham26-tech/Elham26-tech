import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';

interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, actionLabel, onAction }: SectionHeaderProps) {
  const { isRtl } = useTheme();

  return (
    <View style={[styles.row, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
      <Text variant="title" weight="bold">
        {title}
      </Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={8}>
          <Text variant="small" tone="primary" weight="medium">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
});
