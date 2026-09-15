import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { getProduct } from '@/api/services';
import { Badge, Button, Card, EmptyState, Screen, StoneSwatch, Text } from '@/components';
import { useAsync } from '@/lib/useAsync';
import { useFormatters } from '@/lib/usePrice';
import { useSettingsStore } from '@/store/settings';
import { spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

const FINISH_LABELS = {
  polished: { fa: 'صیقلی', en: 'Polished' },
  honed: { fa: 'ساب خورده', en: 'Honed' },
  leather: { fa: 'چرمی', en: 'Leather' },
  flamed: { fa: 'شعله‌ای', en: 'Flamed' },
  bushhammered: { fa: 'تیشه‌ای', en: 'Bush-hammered' },
} as const;

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, colors, isRtl, language } = useTheme();
  const { price, num } = useFormatters();

  const favorites = useSettingsStore((s) => s.favorites);
  const toggleFavorite = useSettingsStore((s) => s.toggleFavorite);

  const { data: product, loading, error, reload } = useAsync(() => getProduct(id), [id]);

  if (loading) return <Screen><EmptyState title={t.common.loading} loading /></Screen>;
  if (error || !product)
    return (
      <Screen>
        <EmptyState title={t.common.error} actionLabel={t.common.retry} onAction={reload} emoji="⚠️" />
      </Screen>
    );

  const isFavorite = favorites.includes(product.id);
  const specRows: { label: string; value: string }[] = [
    { label: t.market.origin, value: language === 'fa' ? product.mineName : product.mineNameEn },
    { label: t.market.dimensions, value: product.specs.dimensions },
    ...(product.specs.thicknessMm
      ? [{ label: t.market.thickness, value: `${num(product.specs.thicknessMm)} mm` }]
      : []),
    { label: t.market.finish, value: FINISH_LABELS[product.specs.finish][language] },
    { label: t.market.waterAbsorption, value: product.specs.waterAbsorption },
    { label: t.market.compressive, value: product.specs.compressiveStrength },
  ];

  return (
    <Screen contentStyle={styles.content}>
      <StoneSwatch color={product.colorHex} size={200} style={styles.hero} />

      <View style={styles.header}>
        <Text variant="heading" weight="bold">
          {language === 'fa' ? product.title : product.titleEn}
        </Text>
        <Text variant="small" tone="muted">
          {product.code} · {language === 'fa' ? product.mineName : product.mineNameEn}
        </Text>
        <View style={[styles.badges, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <Badge
            label={product.stockQuantity > 0 ? t.market.inStock : t.market.outOfStock}
            color={product.stockQuantity > 0 ? colors.green : colors.textFaint}
          />
          {product.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} label={tag} color={colors.primary} />
          ))}
        </View>
      </View>

      <Card accentColor={colors.primary}>
        <View style={[styles.priceRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <View>
            <Text variant="heading" weight="bold" tone="primary">
              {price(product.pricePerUnit)}
            </Text>
            <Text variant="caption" tone="faint">
              {product.unit === 'm2' ? t.common.perSquareMeter : t.common.perTon}
            </Text>
          </View>
          <View style={styles.priceMeta}>
            <Text variant="caption" tone="muted">
              {t.market.minOrder}: {num(product.minOrder)}
            </Text>
            <Text variant="caption" tone="muted">
              {t.market.inStock}: {num(product.stockQuantity)}
            </Text>
          </View>
        </View>
      </Card>

      <Card>
        <Text variant="title" weight="bold" style={styles.sectionTitle}>
          {t.market.specs}
        </Text>
        {specRows.map((row) => (
          <View
            key={row.label}
            style={[
              styles.specRow,
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

      <View style={styles.actions}>
        <Button label={t.market.addToRfq} onPress={() => router.push('/trade/rfq')} size="lg" />
        <Button
          label={isFavorite ? '❤️  ' + t.market.favorite : '🤍  ' + t.market.favorite}
          onPress={() => toggleFavorite(product.id)}
          variant="secondary"
        />
        <Button
          label={t.logistics.virtualTour}
          onPress={() => router.push(`/tour/${product.mineId}`)}
          variant="ghost"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  hero: { alignSelf: 'stretch', width: '100%' },
  header: { gap: spacing.sm },
  badges: { flexWrap: 'wrap', gap: spacing.sm },
  priceRow: { alignItems: 'center', justifyContent: 'space-between' },
  priceMeta: { gap: 2 },
  sectionTitle: { marginBottom: spacing.sm },
  specRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  actions: { gap: spacing.md },
});
