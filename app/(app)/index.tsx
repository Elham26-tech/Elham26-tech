import { router } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listAuctions, listProducts } from '@/api/services';
import {
  Badge,
  BrandMark,
  Card,
  Countdown,
  EmptyState,
  SectionHeader,
  StatTile,
  StoneSwatch,
  Text,
} from '@/components';
import { useFormatters } from '@/lib/usePrice';
import { useAsync } from '@/lib/useAsync';
import { useAuthStore } from '@/store/auth';
import { moduleColors, radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

type ModuleKey = keyof typeof moduleColors;

const MODULES: { key: ModuleKey; emoji: string; href: string }[] = [
  { key: 'mine', emoji: '⛏️', href: '/mine' },
  { key: 'market', emoji: '🛒', href: '/(app)/market' },
  { key: 'auction', emoji: '🔨', href: '/(app)/auction' },
  { key: 'visualizer', emoji: '🪄', href: '/(app)/visualizer' },
  { key: 'affiliate', emoji: '📣', href: '/affiliate' },
  { key: 'logistics', emoji: '🚚', href: '/logistics' },
  { key: 'trade', emoji: '🌍', href: '/trade' },
];

export default function HomeScreen() {
  const { t, tr, colors, isRtl, language } = useTheme();
  const insets = useSafeAreaInsets();
  const { price, num } = useFormatters();
  const user = useAuthStore((s) => s.user);

  const auctions = useAsync(() => listAuctions(), []);
  const products = useAsync(() => listProducts(), []);

  const liveAuctions = (auctions.data ?? []).filter((a) => a.status === 'live');
  const featured = (products.data ?? []).slice(0, 4);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.topBar, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
        <View style={styles.greeting}>
          <Text variant="heading" weight="bold">
            {tr(t.home.greeting, { name: user?.name || t.common.appName })}
          </Text>
          <Text variant="small" tone="muted">
            {t.common.tagline}
          </Text>
        </View>
        <BrandMark size={44} />
      </View>

      <View style={styles.stats}>
        <StatTile
          label={t.home.liveAuctions}
          value={num(liveAuctions.length)}
          color={moduleColors.auction}
        />
        <StatTile
          label={t.market.directSale}
          value={num(products.data?.length ?? 0)}
          color={moduleColors.market}
        />
      </View>

      <View style={styles.section}>
        <SectionHeader title={t.home.modules} />
        <View style={styles.modules}>
          {MODULES.map((module) => (
            <Pressable
              key={module.key}
              onPress={() => router.push(module.href as never)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.module,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radius.lg,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <View style={[styles.moduleIcon, { backgroundColor: `${moduleColors[module.key]}22` }]}>
                <Text variant="title">{module.emoji}</Text>
              </View>
              <Text variant="small" weight="bold">
                {t.modules[module.key]}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={2}>
                {t.modules[`${module.key}Desc` as const]}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader
          title={t.home.liveAuctions}
          actionLabel={t.common.more}
          onAction={() => router.push('/(app)/auction')}
        />
        {auctions.loading ? (
          <EmptyState title={t.common.loading} loading />
        ) : liveAuctions.length === 0 ? (
          <EmptyState title={t.common.empty} emoji="🔨" />
        ) : (
          <View style={styles.list}>
            {liveAuctions.map((auction) => (
              <Card
                key={auction.id}
                accentColor={moduleColors.auction}
                onPress={() => router.push(`/(app)/auction/${auction.id}`)}
              >
                <View style={[styles.auctionRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                  <StoneSwatch color={auction.colorHex} size={60} />
                  <View style={styles.auctionInfo}>
                    <Badge label={t.auction.live} color={colors.red} dot />
                    <Text variant="body" weight="bold" numberOfLines={1}>
                      {language === 'fa' ? auction.title : auction.titleEn}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {t.auction.currentBid}: {price(auction.currentBid)}
                    </Text>
                  </View>
                  <View style={styles.auctionTimer}>
                    <Text variant="caption" tone="faint">
                      {t.auction.timeLeft}
                    </Text>
                    <Countdown target={auction.endsAt} variant="small" weight="bold" tone="red" />
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <SectionHeader
          title={t.home.featured}
          actionLabel={t.common.more}
          onAction={() => router.push('/(app)/market')}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.featuredRow}
        >
          {featured.map((product) => (
            <Card
              key={product.id}
              style={styles.featuredCard}
              onPress={() => router.push(`/(app)/market/${product.id}`)}
            >
              <StoneSwatch color={product.colorHex} size={110} style={styles.featuredSwatch} />
              <Text variant="small" weight="bold" numberOfLines={1}>
                {language === 'fa' ? product.title : product.titleEn}
              </Text>
              <Text variant="caption" tone="primary" weight="medium">
                {price(product.pricePerUnit)}
              </Text>
              <Text variant="caption" tone="faint">
                {product.unit === 'm2' ? t.common.perSquareMeter : t.common.perTon}
              </Text>
            </Card>
          ))}
        </ScrollView>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  topBar: { alignItems: 'center', gap: spacing.md, justifyContent: 'space-between' },
  greeting: { flex: 1, gap: 2 },
  stats: { flexDirection: 'row', gap: spacing.md },
  section: { gap: 0 },
  modules: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  module: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.xs,
    padding: spacing.lg,
  },
  moduleIcon: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 40,
    justifyContent: 'center',
    marginBottom: spacing.xs,
    width: 40,
  },
  list: { gap: spacing.md },
  auctionRow: { alignItems: 'center', gap: spacing.md },
  auctionInfo: { flex: 1, gap: 4 },
  auctionTimer: { alignItems: 'center', gap: 2 },
  featuredRow: { gap: spacing.md, paddingVertical: spacing.xs },
  featuredCard: { gap: 3, width: 150 },
  featuredSwatch: { marginBottom: spacing.sm, width: '100%' },
});
