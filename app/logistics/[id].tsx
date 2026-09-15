import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { getShipment } from '@/api/services';
import type { ShipmentStage } from '@/api/types';
import { Badge, Card, EmptyState, Screen, Text } from '@/components';
import { formatDate } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { useFormatters } from '@/lib/usePrice';
import { moduleColors, radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

export default function ShipmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, colors, isRtl, language } = useTheme();
  const { num } = useFormatters();

  const { data: shipment, loading, error, reload } = useAsync(() => getShipment(id), [id]);

  if (loading || !shipment) {
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

  const stageColor = (status: ShipmentStage['status']) =>
    status === 'done' ? colors.green : status === 'active' ? colors.amber : colors.textFaint;

  const rows: { label: string; value: string }[] = [
    { label: t.logistics.origin, value: language === 'fa' ? shipment.origin : shipment.originEn },
    { label: t.logistics.destination, value: language === 'fa' ? shipment.destination : shipment.destinationEn },
    { label: t.logistics.carrier, value: language === 'fa' ? shipment.carrier : shipment.carrierEn },
    { label: t.logistics.weight, value: `${num(shipment.weightTons)} ${language === 'fa' ? 'تن' : 't'}` },
    { label: t.logistics.eta, value: formatDate(shipment.eta, language) },
  ];

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.header}>
        <Badge label={shipment.trackingCode} color={moduleColors.logistics} />
        <Text variant="title" weight="bold">
          {language === 'fa' ? shipment.productTitle : shipment.productTitleEn}
        </Text>
      </View>

      <Card>
        <Text variant="title" weight="bold" style={styles.sectionTitle}>
          {t.logistics.timeline}
        </Text>

        {shipment.stages.map((stage, index) => {
          const isLast = index === shipment.stages.length - 1;
          const color = stageColor(stage.status);
          return (
            <View
              key={stage.key}
              style={[styles.stageRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}
            >
              <View style={styles.rail}>
                <View style={[styles.dot, { backgroundColor: color, borderColor: colors.surface }]} />
                {!isLast ? <View style={[styles.line, { backgroundColor: colors.border }]} /> : null}
              </View>

              <View style={styles.stageBody}>
                <Text variant="body" weight={stage.status === 'active' ? 'bold' : 'medium'}>
                  {t.logistics.stages[stage.key]}
                </Text>
                <Text variant="caption" style={{ color }}>
                  {t.logistics.stageStatus[stage.status]}
                  {stage.at ? ` · ${formatDate(stage.at, language)}` : ''}
                </Text>
                {stage.note ? (
                  <Text variant="caption" tone="faint">
                    {language === 'fa' ? stage.note : stage.noteEn}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </Card>

      <Card>
        {rows.map((row) => (
          <View
            key={row.label}
            style={[
              styles.detailRow,
              { borderBottomColor: colors.border, flexDirection: isRtl ? 'row-reverse' : 'row' },
            ]}
          >
            <Text variant="small" tone="muted">
              {row.label}
            </Text>
            <Text variant="small" weight="medium">
              {row.value}
            </Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  header: { gap: spacing.sm },
  sectionTitle: { marginBottom: spacing.md },
  stageRow: { gap: spacing.md },
  rail: { alignItems: 'center', width: 18 },
  dot: { borderRadius: radius.pill, borderWidth: 2, height: 14, width: 14 },
  line: { flex: 1, marginVertical: 2, width: 2 },
  stageBody: { flex: 1, gap: 2, paddingBottom: spacing.lg },
  detailRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
});
