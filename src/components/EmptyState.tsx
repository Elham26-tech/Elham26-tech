import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';
import { Button } from './Button';
import { Text } from './Text';

interface EmptyStateProps {
  title: string;
  description?: string;
  loading?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  emoji?: string;
}

export function EmptyState({
  title,
  description,
  loading,
  actionLabel,
  onAction,
  emoji = '🪨',
}: EmptyStateProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator color={colors.primary} size="large" />
      ) : (
        <Text variant="display">{emoji}</Text>
      )}
      <Text variant="title" weight="bold" center>
        {title}
      </Text>
      {description ? (
        <Text variant="small" tone="muted" center>
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction && !loading ? (
        <Button label={actionLabel} onPress={onAction} fullWidth={false} size="sm" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.md,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl * 1.5,
  },
});
