import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { listProducts } from '@/api/services';
import type { StoneCategory } from '@/api/types';
import { Badge, Card, Chip, EmptyState, Screen, StoneSwatch, Text, TextField } from '@/components';
import { useAsync } from '@/lib/useAsync';
import { useFormatters } from '@/lib/usePrice';
import { useSettingsStore } from '@/store/settings';
import { moduleColors, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

type CategoryFilter = StoneCategory | 'all';

const CATEGORY_LABELS: Record<CategoryFilter, { fa: string; en: string }> = {
  all: { fa: 'همه', en: 'All' },
  block: { fa: 'کوپ', en: 'Blocks' },
  slab: { fa: 'اسلب', en: 'Slabs' },
  tile: { fa: 'تایل', en: 'Tiles' },
  crushed: { fa: 'سنگ‌دانه', en: 'Aggregate' },
};

export default function MarketScreen() {
  const { t, colors, isRtl, language } = useTheme();
  const { price, num, rating } = useFormatters();
  const favorites = useSettingsStore((s) => s.favorites);
  const toggleFavorite = useSettingsStore((s) => s.toggleFavorite);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');

  const { data, loading } = useAsync(() => listProducts({ search, category }), [search, category]);
  const products = useMemo(() => data ?? [], [data]);

  return (
    <Screen contentStyle={styles.content}>
      <TextField
        placeholder={t.market.searchPlaceholder}
        value={search}
        onChangeText={setSearch}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {(Object.keys(CATEGORY_LABELS) as CategoryFilter[]).map((key) => (
          <Chip
            key={key}
            label={CATEGORY_LABELS[key][language]}
            selected={category === key}
            onPress={() => setCategory(key)}
          />
        ))}
      </ScrollView>

      {loading ? (
        <EmptyState title={t.common.loading} loading />
      ) : products.length === 0 ? (
        <EmptyState title={t.common.empty} emoji="🔍" />
      ) : (
        <View style={styles.list}>
          {products.map((product) => {
            const isFavorite = favorites.includes(product.id);
            return (
              <Card key={product.id} onPress={() => router.push(`/(app)/market/${product.id}`)}>
                <View style={[styles.row, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                  <StoneSwatch color={product.colorHex} size={82} />

                  <View style={styles.info}>
                    <View style={[styles.titleRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                      <Text variant="body" weight="bold" numberOfLines={1} style={styles.flex}>
                        {language === 'fa' ? product.title : product.titleEn}
                      </Text>
                      <Pressable
                        onPress={() => toggleFavorite(product.id)}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={t.market.favorite}
                      >
                        <Text variant="title">{isFavorite ? '❤️' : '🤍'}</Text>
                      </Pressable>
                    </View>

                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {language === 'fa' ? product.mineName : product.mineNameEn} · {product.code}
                    </Text>

                    <View style={[styles.metaRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                      <Text variant="small" weight="bold" tone="primary">
                        {price(product.pricePerUnit)}
                      </Text>
                      <Text variant="caption" tone="faint">
                        {product.unit === 'm2' ? t.common.perSquareMeter : t.common.perTon}
                      </Text>
                    </View>

                    <View style={[styles.metaRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                      <Badge
                        label={product.stockQuantity > 0 ? t.market.inStock : t.market.outOfStock}
                        color={product.stockQuantity > 0 ? colors.green : colors.textFaint}
                      />
                      <Text variant="caption" tone="faint">
                        {t.market.minOrder}: {num(product.minOrder)}
                      </Text>
                      <Text variant="caption" tone="amber">
                        ★ {rating(product.rating)}
                      </Text>
                    </View>
                  </View>
                </View>
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  chips: { gap: spacing.sm, paddingVertical: spacing.xs },
  list: { gap: spacing.md },
  row: { gap: spacing.md },
  info: { flex: 1, gap: 4 },
  titleRow: { alignItems: 'center', gap: spacing.sm },
  metaRow: { alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
});
