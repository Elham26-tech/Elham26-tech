import React from 'react';
import { StyleSheet } from 'react-native';

import { getExportGuide } from '@/api/services';
import { Card, EmptyState, Screen, Text } from '@/components';
import { useAsync } from '@/lib/useAsync';
import { moduleColors, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

export default function ExportGuideScreen() {
  const { t, language } = useTheme();
  const { data, loading, error, reload } = useAsync(() => getExportGuide(), []);

  if (loading || !data) {
    return (
      <Screen>
        {error ? (
          <EmptyState title={t.common.error} actionLabel={t.common.retry} onAction={reload} emoji="⚠️" />
        ) : (
          <EmptyState title={t.common.loading} loading />
        )}
      </Screen>
    );
  }

  return (
    <Screen contentStyle={styles.content}>
      <Text variant="small" tone="muted">
        {t.trade.guideDesc}
      </Text>
      {data.map((section) => (
        <Card key={section.id} accentColor={moduleColors.trade}>
          <Text variant="body" weight="bold" style={styles.title}>
            {language === 'fa' ? section.title : section.titleEn}
          </Text>
          <Text variant="small" tone="muted" style={styles.body}>
            {language === 'fa' ? section.body : section.bodyEn}
          </Text>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  title: { marginBottom: spacing.sm },
  body: { lineHeight: 24 },
});
