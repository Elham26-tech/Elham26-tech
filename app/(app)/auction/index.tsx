import { router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { listAuctions } from '@/api/services';
import type { AuctionStatus } from '@/api/types';
import { Badge, Card, Chip, Countdown, EmptyState, Screen, StoneSwatch, Text } from '@/components';
import { formatDate } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { useFormatters } from '@/lib/usePrice';
import { spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

const FILTERS: AuctionStatus[] = ['live', 'upcoming', 'ended'];

export default function AuctionListScreen() {
  const { t, colors, isRtl, language } = useTheme();
  const { price, num } = useFormatters();
  const [filter, setFilter] = useState<AuctionStatus>('live');

  const { data, loading, reload } = useAsync(() => listAuctions(), []);
  const auctions = (data ?? []).filter((a) => a.status === filter);

  const statusColor: Record<AuctionStatus, string> = {
    live: colors.red,
    upcoming: colors.amber,
    ended: colors.textFaint,
  };

  return (
    <Screen contentStyle={styles.content}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {FILTERS.map((key) => (
          <Chip
            key={key}
            label={t.auction[key]}
            selected={filter === key}
            color={statusColor[key]}
            onPress={() => setFilter(key)}
          />
        ))}
      </ScrollView>

      {loading ? (
        <EmptyState title={t.common.loading} loading />
      ) : auctions.length === 0 ? (
        <EmptyState title={t.common.empty} emoji="🔨" actionLabel={t.common.retry} onAction={reload} />
      ) : (
        <View style={styles.list}>
          {auctions.map((auction) => (
            <Card
              key={auction.id}
              accentColor={statusColor[auction.status]}
              onPress={() => router.push(`/(app)/auction/${auction.id}`)}
            >
              <View style={[styles.row, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                <StoneSwatch color={auction.colorHex} size={76} />
                <View style={styles.info}>
                  <Badge
                    label={t.auction[auction.status]}
                    color={statusColor[auction.status]}
                    dot={auction.status === 'live'}
                  />
                  <Text variant="body" weight="bold" numberOfLines={1}>
                    {language === 'fa' ? auction.title : auction.titleEn}
                  </Text>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {auction.lotCode} · {language === 'fa' ? auction.mineName : auction.mineNameEn} ·{' '}
                    {num(auction.volumeM3)} m³
                  </Text>
                  <Text variant="small" weight="bold" tone="primary">
                    {price(auction.currentBid)}
                  </Text>
                </View>

                <View style={styles.meta}>
                  {auction.status === 'live' ? (
                    <>
                      <Text variant="caption" tone="faint">
                        {t.auction.timeLeft}
                      </Text>
                      <Countdown target={auction.endsAt} variant="small" weight="bold" tone="red" />
                    </>
                  ) : (
                    <Text variant="caption" tone="faint" center>
                      {formatDate(auction.status === 'upcoming' ? auction.startsAt : auction.endsAt, language)}
                    </Text>
                  )}
                </View>
              </View>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  chips: { gap: spacing.sm, paddingVertical: spacing.xs },
  list: { gap: spacing.md },
  row: { alignItems: 'center', gap: spacing.md },
  info: { flex: 1, gap: 4 },
  meta: { alignItems: 'center', gap: 2, maxWidth: 90 },
});
