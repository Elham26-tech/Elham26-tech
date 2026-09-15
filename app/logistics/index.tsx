import { router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { listShipments, listVirtualTours } from '@/api/services';
import { Badge, Card, EmptyState, Screen, SectionHeader, StoneSwatch, Text } from '@/components';
import { formatDate } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { useFormatters } from '@/lib/usePrice';
import { moduleColors, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

export default function LogisticsScreen() {
  const { t, colors, isRtl, language } = useTheme();
  const { num } = useFormatters();

  const shipments = useAsync(() => listShipments(), []);
  const tours = useAsync(() => listVirtualTours(), []);

  return (
    <Screen contentStyle={styles.content}>
      <View>
        <SectionHeader title={t.logistics.virtualTour} />
        <Text variant="small" tone="muted" style={styles.intro}>
          {t.logistics.tourDesc}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tourRow}>
          {(tours.data ?? []).map((tour) => (
            <Card key={tour.id} style={styles.tourCard} onPress={() => router.push(`/tour/${tour.id}`)}>
              <StoneSwatch color={tour.coverColor} size={104} style={styles.tourSwatch} label="360°" />
              <Text variant="small" weight="bold" numberOfLines={1}>
                {language === 'fa' ? tour.mineName : tour.mineNameEn}
              </Text>
              <Text variant="caption" tone="faint">
                {language === 'fa' ? tour.city : tour.cityEn} · {num(tour.scenes)}{' '}
                {language === 'fa' ? 'صحنه' : 'scenes'}
              </Text>
            </Card>
          ))}
        </ScrollView>
      </View>

      <View>
        <SectionHeader title={t.logistics.shipments} />
        {shipments.loading ? (
          <EmptyState title={t.common.loading} loading />
        ) : (shipments.data ?? []).length === 0 ? (
          <EmptyState title={t.common.empty} emoji="🚚" />
        ) : (
          <View style={styles.list}>
            {(shipments.data ?? []).map((shipment) => {
              const activeStage = shipment.stages.find((s) => s.status === 'active');
              const delivered = shipment.stages.every((s) => s.status === 'done');
              return (
                <Card
                  key={shipment.id}
                  accentColor={delivered ? colors.green : moduleColors.logistics}
                  onPress={() => router.push(`/logistics/${shipment.id}`)}
                >
                  <View style={[styles.headRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                    <Badge
                      label={shipment.trackingCode}
                      color={delivered ? colors.green : moduleColors.logistics}
                    />
                    {shipment.international ? <Badge label="🌍" color={colors.purple} /> : null}
                  </View>

                  <Text variant="body" weight="bold" numberOfLines={1} style={styles.shipmentTitle}>
                    {language === 'fa' ? shipment.productTitle : shipment.productTitleEn}
                  </Text>

                  <Text variant="caption" tone="muted">
                    {language === 'fa' ? shipment.origin : shipment.originEn} ←{' '}
                    {language === 'fa' ? shipment.destination : shipment.destinationEn}
                  </Text>

                  <View style={[styles.metaRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                    <Text variant="caption" tone="faint">
                      {t.logistics.weight}: {num(shipment.weightTons)} {language === 'fa' ? 'تن' : 't'}
                    </Text>
                    <Text variant="caption" tone={delivered ? 'green' : 'primary'} weight="medium">
                      {delivered
                        ? t.logistics.stageStatus.done
                        : `${t.logistics.eta}: ${formatDate(shipment.eta, language)}`}
                    </Text>
                  </View>

                  {activeStage ? (
                    <Text variant="caption" tone="amber" style={styles.activeStage}>
                      ● {t.logistics.stages[activeStage.key]}
                      {activeStage.note
                        ? ` — ${language === 'fa' ? activeStage.note : activeStage.noteEn}`
                        : ''}
                    </Text>
                  ) : null}
                </Card>
              );
            })}
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl },
  intro: { marginBottom: spacing.md, marginTop: -spacing.sm },
  tourRow: { gap: spacing.md, paddingVertical: spacing.xs },
  tourCard: { gap: 2, width: 150 },
  tourSwatch: { marginBottom: spacing.sm, width: '100%' },
  list: { gap: spacing.md },
  headRow: { alignItems: 'center', gap: spacing.sm },
  shipmentTitle: { marginTop: spacing.sm },
  metaRow: { alignItems: 'center', gap: spacing.md, justifyContent: 'space-between', marginTop: spacing.sm },
  activeStage: { marginTop: spacing.sm },
});
