import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { ApiError } from '@/api/client';
import { getAuction, placeBid } from '@/api/services';
import type { Auction } from '@/api/types';
import {
  Badge,
  Button,
  Card,
  Countdown,
  EmptyState,
  Screen,
  StoneSwatch,
  Text,
  TextField,
} from '@/components';
import { formatDate, toLatinDigits } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { useFormatters } from '@/lib/usePrice';
import { useAuthStore } from '@/store/auth';
import { spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

export default function AuctionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, tr, colors, isRtl, language } = useTheme();
  const { price, num } = useFormatters();
  const user = useAuthStore((s) => s.user);

  const { data, loading, error, reload } = useAsync(() => getAuction(id), [id]);
  const [auction, setAuction] = useState<Auction | null>(null);
  const [amount, setAmount] = useState('');
  const [bidError, setBidError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (data) {
      setAuction(data);
      setAmount(String(data.currentBid + data.bidStep));
    }
  }, [data]);

  if (loading || !auction) {
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

  const minimumBid = auction.currentBid + auction.bidStep;
  const isLive = auction.status === 'live';
  const myBid = auction.bids.find((b) => b.isMine);
  const isWinning = auction.bids[0]?.isMine === true;

  const submitBid = async () => {
    const value = Number(toLatinDigits(amount).replace(/\D/g, ''));
    setNotice(null);
    if (!Number.isFinite(value) || value < minimumBid) {
      setBidError(tr(t.auction.bidTooLow, { min: price(minimumBid) }));
      return;
    }
    setBidError(null);
    setSubmitting(true);
    try {
      const updated = await placeBid(auction.id, value, user?.name || t.auction.yourBid);
      setAuction({ ...updated, bids: [...updated.bids] });
      setAmount(String(updated.currentBid + updated.bidStep));
      setNotice(t.auction.bidPlaced);
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'bid_too_low') {
        setBidError(tr(t.auction.bidTooLow, { min: price(minimumBid) }));
      } else if (err instanceof ApiError && err.code === 'auction_not_live') {
        setBidError(t.auction.finished);
      } else {
        setBidError(t.common.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen contentStyle={styles.content}>
      <StoneSwatch color={auction.colorHex} size={180} style={styles.hero} />

      <View style={styles.header}>
        <View style={[styles.badges, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <Badge
            label={t.auction[auction.status]}
            color={isLive ? colors.red : auction.status === 'upcoming' ? colors.amber : colors.textFaint}
            dot={isLive}
          />
          <Badge label={auction.lotCode} color={colors.primary} />
        </View>
        <Text variant="heading" weight="bold">
          {language === 'fa' ? auction.title : auction.titleEn}
        </Text>
        <Text variant="small" tone="muted">
          {language === 'fa' ? auction.mineName : auction.mineNameEn} · {num(auction.volumeM3)} m³
        </Text>
      </View>

      <Card accentColor={isLive ? colors.red : colors.border}>
        <View style={[styles.bidRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <View style={styles.flex}>
            <Text variant="caption" tone="muted">
              {t.auction.currentBid}
            </Text>
            <Text variant="heading" weight="bold" tone="primary">
              {price(auction.currentBid)}
            </Text>
            <Text variant="caption" tone="faint">
              {t.auction.startingPrice}: {price(auction.startingPrice)}
            </Text>
          </View>
          <View style={styles.timer}>
            <Text variant="caption" tone="muted">
              {t.auction.timeLeft}
            </Text>
            {isLive ? (
              <Countdown
                target={auction.endsAt}
                variant="title"
                weight="bold"
                tone="red"
                onFinish={reload}
              />
            ) : (
              <Text variant="small" weight="medium" tone="faint">
                {formatDate(auction.status === 'upcoming' ? auction.startsAt : auction.endsAt, language)}
              </Text>
            )}
          </View>
        </View>

        {isWinning ? (
          <View style={[styles.notice, { backgroundColor: `${colors.green}22` }]}>
            <Text variant="small" tone="green" weight="medium">
              ✓ {t.auction.youAreWinning}
            </Text>
          </View>
        ) : myBid ? (
          <View style={[styles.notice, { backgroundColor: `${colors.amber}22` }]}>
            <Text variant="small" tone="amber" weight="medium">
              {t.auction.outbid} — {price(myBid.amount)}
            </Text>
          </View>
        ) : null}
      </Card>

      {isLive ? (
        <Card>
          <Text variant="title" weight="bold" style={styles.sectionTitle}>
            {t.auction.placeBid}
          </Text>
          <TextField
            label={t.auction.yourBid}
            value={amount}
            onChangeText={(text) => {
              setAmount(toLatinDigits(text).replace(/\D/g, ''));
              if (bidError) setBidError(null);
            }}
            keyboardType="number-pad"
            hint={`${t.auction.bidStep}: ${price(auction.bidStep)} · ${t.auction.currentBid} + ${t.auction.bidStep} = ${price(minimumBid)}`}
            error={bidError}
            prefix={
              <Text variant="small" tone="muted">
                {t.common.currency}
              </Text>
            }
          />
          {notice ? (
            <Text variant="small" tone="green" style={styles.sectionTitle}>
              {notice}
            </Text>
          ) : null}
          <Button
            label={t.auction.placeBid}
            onPress={() => void submitBid()}
            loading={submitting}
            variant="amber"
            size="lg"
            style={styles.bidButton}
          />
        </Card>
      ) : (
        <Card>
          <Text variant="small" tone="muted" center>
            {auction.status === 'ended' ? t.auction.finished : t.auction.upcoming}
          </Text>
        </Card>
      )}

      <Card>
        <Text variant="title" weight="bold" style={styles.sectionTitle}>
          {t.auction.bidHistory}
        </Text>
        {auction.bids.length === 0 ? (
          <Text variant="small" tone="faint">
            {t.common.empty}
          </Text>
        ) : (
          auction.bids.map((bid) => (
            <View
              key={bid.id}
              style={[
                styles.historyRow,
                { borderBottomColor: colors.border, flexDirection: isRtl ? 'row-reverse' : 'row' },
              ]}
            >
              <Text variant="small" weight={bid.isMine ? 'bold' : 'regular'} tone={bid.isMine ? 'green' : 'default'}>
                {bid.isMine ? t.auction.yourBid : bid.bidderLabel}
              </Text>
              <Text variant="small" weight="medium">
                {price(bid.amount)}
              </Text>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  hero: { alignSelf: 'stretch', width: '100%' },
  header: { gap: spacing.sm },
  badges: { gap: spacing.sm },
  bidRow: { alignItems: 'flex-start', gap: spacing.md },
  timer: { alignItems: 'flex-end', gap: 2 },
  flex: { flex: 1 },
  notice: { borderRadius: 10, marginTop: spacing.md, padding: spacing.md },
  sectionTitle: { marginBottom: spacing.sm },
  bidButton: { marginTop: spacing.md },
  historyRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
});
