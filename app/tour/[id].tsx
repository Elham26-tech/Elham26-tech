import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { listVirtualTours } from '@/api/services';
import { Badge, Card, EmptyState, Screen, StoneSwatch, Text } from '@/components';
import { useAsync } from '@/lib/useAsync';
import { useFormatters } from '@/lib/usePrice';
import { moduleColors, radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * 360° tour viewer. The panorama renderer is a native module the backend will
 * supply scene assets for; until then the screen shows the scene list and a
 * stand-in stage so the navigation and scene model are already in place.
 */
export default function TourScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, colors, isRtl, language } = useTheme();
  const { num } = useFormatters();
  const [scene, setScene] = useState(0);

  const { data, loading } = useAsync(() => listVirtualTours(), []);
  const tour = (data ?? []).find((item) => item.id === id) ?? (data ?? [])[0];

  if (loading || !tour) {
    return (
      <Screen>
        <EmptyState title={loading ? t.common.loading : t.common.empty} loading={loading} emoji="🎥" />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={styles.content}>
      <Card padded={false} style={styles.stage}>
        <StoneSwatch color={tour.coverColor} size={240} style={styles.panorama} />
        <View style={[styles.stageOverlay, { backgroundColor: colors.overlay }]}>
          <Badge label="360°" color={moduleColors.logistics} />
          <Text variant="small" weight="bold" tone="inverse">
            {language === 'fa' ? tour.mineName : tour.mineNameEn}
          </Text>
        </View>
      </Card>

      <View style={styles.header}>
        <Text variant="title" weight="bold">
          {language === 'fa' ? tour.mineName : tour.mineNameEn}
        </Text>
        <Text variant="small" tone="muted">
          {language === 'fa' ? tour.city : tour.cityEn} · {num(tour.scenes)}{' '}
          {language === 'fa' ? 'صحنه' : 'scenes'}
        </Text>
      </View>

      <View style={[styles.scenes, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
        {Array.from({ length: tour.scenes }, (_, index) => (
          <Pressable
            key={index}
            onPress={() => setScene(index)}
            accessibilityRole="button"
            style={[
              styles.scene,
              {
                backgroundColor: scene === index ? colors.primary : colors.surfaceAlt,
                borderColor: scene === index ? colors.primary : colors.border,
                borderRadius: radius.sm,
              },
            ]}
          >
            <Text variant="caption" weight="bold" tone={scene === index ? 'inverse' : 'muted'}>
              {num(index + 1)}
            </Text>
          </Pressable>
        ))}
      </View>

      <Card>
        <Text variant="small" tone="muted">
          {t.logistics.tourDesc}
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  stage: { overflow: 'hidden' },
  panorama: { height: 240, width: '100%' },
  stageOverlay: {
    alignItems: 'center',
    bottom: 0,
    flexDirection: 'row',
    gap: spacing.md,
    left: 0,
    padding: spacing.md,
    position: 'absolute',
    right: 0,
  },
  header: { gap: spacing.xs },
  scenes: { flexWrap: 'wrap', gap: spacing.sm },
  scene: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
});
