import React from 'react';
import { StyleSheet, View } from 'react-native';

import { getMineDashboard } from '@/api/services';
import type { InventoryItem } from '@/api/types';
import {
  Badge,
  Card,
  EmptyState,
  ProgressBar,
  Screen,
  SectionHeader,
  StatTile,
  Text,
} from '@/components';
import { formatDate } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { useFormatters } from '@/lib/usePrice';
import { moduleColors, radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

const CATEGORY_LABELS = {
  block: { fa: 'کوپ', en: 'Block' },
  slab: { fa: 'اسلب', en: 'Slab' },
  tile: { fa: 'تایل', en: 'Tile' },
  crushed: { fa: 'سنگ‌دانه', en: 'Aggregate' },
} as const;

const STATUS_LABELS = {
  raw: { fa: 'خام', en: 'Raw' },
  processing: { fa: 'در فرآوری', en: 'Processing' },
  ready: { fa: 'آماده فروش', en: 'Ready' },
  reserved: { fa: 'رزرو شده', en: 'Reserved' },
} as const;

export default function MineScreen() {
  const { t, colors, isRtl, language } = useTheme();
  const { num, percent } = useFormatters();
  const { data, loading, error, reload } = useAsync(() => getMineDashboard(), []);

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

  const statusColor: Record<InventoryItem['status'], string> = {
    raw: colors.textFaint,
    processing: colors.amber,
    ready: colors.green,
    reserved: colors.primary,
  };

  const maxCapacity = Math.max(...data.production.map((p) => p.capacity));

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.stats}>
        <StatTile
          label={t.mine.efficiency}
          value={percent(data.efficiency)}
          color={moduleColors.mine}
        />
        <StatTile
          label={t.mine.production}
          value={`${num(data.monthlyOutputTons)} ${language === 'fa' ? 'تن' : 't'}`}
          color={moduleColors.logistics}
        />
      </View>

      <View>
        <SectionHeader title={t.mine.production} />
        <Card>
          <View style={[styles.chart, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            {data.production.map((point) => (
              <View key={point.label} style={styles.bar}>
                <View style={[styles.barTrack, { backgroundColor: colors.surfaceAlt }]}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        backgroundColor: moduleColors.mine,
                        height: `${(point.output / maxCapacity) * 100}%`,
                      },
                    ]}
                  />
                </View>
                <Text variant="caption" tone="faint" numberOfLines={1}>
                  {language === 'fa' ? point.label.slice(0, 3) : point.labelEn}
                </Text>
                <Text variant="caption" weight="medium">
                  {num(point.output)}
                </Text>
              </View>
            ))}
          </View>
          <Text variant="caption" tone="faint" center style={styles.chartCaption}>
            {t.mine.capacity}: {num(maxCapacity)} {language === 'fa' ? 'تن در روز' : 't/day'}
          </Text>
        </Card>
      </View>

      <View>
        <SectionHeader title={t.mine.inventory} />
        <View style={styles.list}>
          {data.inventory.map((item) => (
            <Card key={item.id} accentColor={statusColor[item.status]}>
              <View style={[styles.row, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                <View style={styles.flex}>
                  <Text variant="body" weight="bold">
                    {item.batchCode} · {CATEGORY_LABELS[item.category][language]}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {t.mine.extractedOn}: {formatDate(item.extractedAt, language)}
                  </Text>
                  <Badge
                    label={STATUS_LABELS[item.status][language]}
                    color={statusColor[item.status]}
                    style={styles.badge}
                  />
                </View>
                <View style={styles.quantity}>
                  <Text variant="title" weight="bold">
                    {num(item.quantity)}
                  </Text>
                  <Text variant="caption" tone="faint">
                    {item.unit === 'm2' ? 'm²' : item.unit === 'ton' ? (language === 'fa' ? 'تن' : 't') : 'pcs'}
                  </Text>
                  <Text variant="caption" tone="amber" weight="bold">
                    {t.mine.quality} {item.grade}
                  </Text>
                </View>
              </View>
            </Card>
          ))}
        </View>
      </View>

      <View>
        <SectionHeader title={t.mine.workOrders} />
        <View style={styles.list}>
          {data.workOrders.map((order) => (
            <Card
              key={order.id}
              accentColor={
                order.priority === 'high'
                  ? colors.red
                  : order.priority === 'normal'
                    ? colors.amber
                    : colors.textFaint
              }
            >
              <View style={[styles.row, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                <View style={styles.flex}>
                  <Text variant="body" weight="bold" numberOfLines={1}>
                    {language === 'fa' ? order.title : order.titleEn}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {order.code} · {order.assignee}
                  </Text>
                </View>
                <Text variant="small" weight="bold" tone="primary">
                  {percent(order.progress)}
                </Text>
              </View>
              <View style={styles.progress}>
                <ProgressBar value={order.progress} color={moduleColors.mine} />
              </View>
            </Card>
          ))}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl },
  stats: { flexDirection: 'row', gap: spacing.md },
  chart: { alignItems: 'flex-end', gap: spacing.sm, height: 150 },
  bar: { alignItems: 'center', flex: 1, gap: 2 },
  barTrack: { borderRadius: radius.sm, flex: 1, justifyContent: 'flex-end', overflow: 'hidden', width: '100%' },
  barFill: { borderRadius: radius.sm, width: '100%' },
  chartCaption: { marginTop: spacing.md },
  list: { gap: spacing.md },
  row: { alignItems: 'flex-start', gap: spacing.md },
  flex: { flex: 1, gap: 2 },
  badge: { marginTop: spacing.sm },
  quantity: { alignItems: 'center', gap: 2 },
  progress: { marginTop: spacing.md },
});
