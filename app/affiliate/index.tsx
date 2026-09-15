import * as Clipboard from 'expo-clipboard';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { getAffiliateStats } from '@/api/services';
import { Button, Card, EmptyState, Screen, SectionHeader, StatTile, Text } from '@/components';
import { useAsync } from '@/lib/useAsync';
import { useFormatters } from '@/lib/usePrice';
import { useAuthStore } from '@/store/auth';
import { moduleColors, radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

export default function AffiliateScreen() {
  const { t, colors, isRtl, language } = useTheme();
  const { price, num, percent } = useFormatters();
  const user = useAuthStore((s) => s.user);
  const [copied, setCopied] = useState(false);

  const { data, loading, error, reload } = useAsync(
    () => getAffiliateStats(user?.affiliateCode ?? 'SB0000'),
    [user?.affiliateCode],
  );

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

  const copyLink = async () => {
    await Clipboard.setStringAsync(data.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Screen contentStyle={styles.content}>
      <Text variant="small" tone="muted">
        {t.affiliate.subtitle}
      </Text>

      <Card accentColor={moduleColors.affiliate}>
        <Text variant="small" tone="muted">
          {t.affiliate.myLink}
        </Text>
        <View style={[styles.linkBox, { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm }]}>
          <Text variant="small" weight="medium" numberOfLines={1} style={styles.link}>
            {data.link}
          </Text>
        </View>
        <Button
          label={copied ? t.affiliate.copied : t.affiliate.copyLink}
          onPress={() => void copyLink()}
          variant={copied ? 'secondary' : 'primary'}
          style={styles.copyButton}
        />
      </Card>

      <View style={styles.stats}>
        <StatTile label={t.affiliate.clicks} value={num(data.clicks)} color={moduleColors.market} />
        <StatTile label={t.affiliate.leads} value={num(data.leads)} color={moduleColors.logistics} />
        <StatTile
          label={t.affiliate.conversions}
          value={num(data.conversions)}
          color={moduleColors.affiliate}
        />
        <StatTile
          label={t.affiliate.commissionRate}
          value={percent(data.commissionRate)}
          color={moduleColors.mine}
        />
      </View>

      <Card>
        <Text variant="title" weight="bold" style={styles.sectionTitle}>
          {t.affiliate.earned}
        </Text>
        <Text variant="display" weight="bold" tone="green">
          {price(data.earnedTotal)}
        </Text>

        <View style={[styles.payoutRow, { borderTopColor: colors.border, flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <View style={styles.flex}>
            <Text variant="caption" tone="muted">
              {t.affiliate.pending}
            </Text>
            <Text variant="small" weight="bold" tone="amber">
              {price(data.pendingPayout)}
            </Text>
          </View>
          <View style={styles.flex}>
            <Text variant="caption" tone="muted">
              {t.affiliate.paid}
            </Text>
            <Text variant="small" weight="bold">
              {price(data.paidOut)}
            </Text>
          </View>
        </View>

        <Button
          label={t.affiliate.withdraw}
          onPress={() => undefined}
          variant="amber"
          style={styles.copyButton}
          disabled={data.pendingPayout <= 0}
        />
      </Card>

      <View>
        <SectionHeader title={t.affiliate.topProducts} />
        <View style={styles.list}>
          {data.topProducts.map((item, index) => (
            <Card key={item.productId}>
              <View style={[styles.productRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                <View style={[styles.rank, { backgroundColor: colors.primarySoft, borderRadius: radius.pill }]}>
                  <Text variant="small" weight="bold" tone="primary">
                    {num(index + 1)}
                  </Text>
                </View>
                <Text variant="small" weight="medium" numberOfLines={1} style={styles.flex}>
                  {language === 'fa' ? item.title : item.titleEn}
                </Text>
                <Text variant="small" weight="bold" tone="green">
                  {price(item.earned)}
                </Text>
              </View>
            </Card>
          ))}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  linkBox: { marginTop: spacing.sm, padding: spacing.md },
  link: { writingDirection: 'ltr' },
  copyButton: { marginTop: spacing.md },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  sectionTitle: { marginBottom: spacing.sm },
  payoutRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.lg,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
  },
  flex: { flex: 1, gap: 2 },
  list: { gap: spacing.md },
  productRow: { alignItems: 'center', gap: spacing.md },
  rank: { alignItems: 'center', height: 28, justifyContent: 'center', width: 28 },
});
