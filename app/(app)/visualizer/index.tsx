import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { suggestStones } from '@/api/services';
import type {
  DurabilityLevel,
  VisualizerSpace,
  VisualizerStyle,
  VisualizerSuggestion,
} from '@/api/types';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ProgressBar,
  Screen,
  SectionHeader,
  StoneSwatch,
  Text,
} from '@/components';
import { useFormatters } from '@/lib/usePrice';
import { moduleColors, radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

const STYLES: VisualizerStyle[] = ['modern', 'classic', 'minimal', 'luxury', 'rustic'];
const SPACES: VisualizerSpace[] = ['facade', 'floor', 'wall', 'kitchen', 'bathroom', 'stairs'];
const DURABILITY: DurabilityLevel[] = ['standard', 'high', 'extreme'];

export default function VisualizerScreen() {
  const { t, colors, isRtl, language } = useTheme();
  const { num } = useFormatters();

  const [photo, setPhoto] = useState<string | null>(null);
  const [style, setStyle] = useState<VisualizerStyle>('modern');
  const [space, setSpace] = useState<VisualizerSpace>('floor');
  const [durability, setDurability] = useState<DurabilityLevel>('high');
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState<VisualizerSuggestion[] | null>(null);
  const [applied, setApplied] = useState<VisualizerSuggestion | null>(null);

  const pickPhoto = async (source: 'library' | 'camera') => {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, mediaTypes: ['images'] });

    if (!result.canceled && result.assets[0]) {
      setPhoto(result.assets[0].uri);
      setResults(null);
      setApplied(null);
    }
  };

  const analyze = async () => {
    setAnalyzing(true);
    setApplied(null);
    try {
      setResults(await suggestStones({ style, space, durability, photoUri: photo ?? undefined }));
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <Screen contentStyle={styles.content}>
      <Text variant="small" tone="muted">
        {t.visualizer.subtitle}
      </Text>

      <Card padded={false} style={styles.preview}>
        {photo ? (
          <View>
            <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" />
            {applied ? (
              <View style={[styles.overlay, { backgroundColor: `${applied.colorHex}99` }]}>
                <Text variant="small" weight="bold" style={styles.overlayLabel}>
                  {language === 'fa' ? applied.title : applied.titleEn}
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={[styles.placeholder, { backgroundColor: colors.surfaceAlt }]}>
            <Text variant="display">🏛️</Text>
            <Text variant="small" tone="faint">
              {t.visualizer.pickPhoto}
            </Text>
          </View>
        )}
      </Card>

      <View style={[styles.photoActions, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
        <Button
          label={t.visualizer.pickPhoto}
          onPress={() => void pickPhoto('library')}
          variant="secondary"
          style={styles.flex}
        />
        <Button
          label={t.visualizer.takePhoto}
          onPress={() => void pickPhoto('camera')}
          variant="ghost"
          style={styles.flex}
        />
      </View>

      <OptionGroup title={t.visualizer.style}>
        {STYLES.map((key) => (
          <Chip
            key={key}
            label={t.visualizer.styles[key]}
            selected={style === key}
            color={moduleColors.visualizer}
            onPress={() => setStyle(key)}
          />
        ))}
      </OptionGroup>

      <OptionGroup title={t.visualizer.space}>
        {SPACES.map((key) => (
          <Chip
            key={key}
            label={t.visualizer.spaces[key]}
            selected={space === key}
            color={moduleColors.visualizer}
            onPress={() => setSpace(key)}
          />
        ))}
      </OptionGroup>

      <OptionGroup title={t.visualizer.durability}>
        {DURABILITY.map((key) => (
          <Chip
            key={key}
            label={t.visualizer.durabilityLevels[key]}
            selected={durability === key}
            color={moduleColors.visualizer}
            onPress={() => setDurability(key)}
          />
        ))}
      </OptionGroup>

      <Button
        label={analyzing ? t.visualizer.analyzing : t.visualizer.analyze}
        onPress={() => void analyze()}
        loading={analyzing}
        size="lg"
      />

      {results ? (
        <View style={styles.results}>
          <SectionHeader title={t.visualizer.results} />
          {results.length === 0 ? (
            <EmptyState title={t.common.empty} emoji="🪄" />
          ) : (
            results.map((item) => (
              <Card key={item.productId} accentColor={moduleColors.visualizer}>
                <View style={[styles.resultRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                  <StoneSwatch color={item.colorHex} size={68} />
                  <View style={styles.resultInfo}>
                    <Text variant="body" weight="bold" numberOfLines={1}>
                      {language === 'fa' ? item.title : item.titleEn}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {t.visualizer.matchScore}: {num(item.matchScore)}٪
                    </Text>
                    <ProgressBar value={item.matchScore / 100} color={moduleColors.visualizer} />
                    <Text variant="caption" tone="faint">
                      {language === 'fa' ? item.reason : item.reasonEn}
                    </Text>
                  </View>
                </View>

                <View style={[styles.resultActions, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                  <Pressable
                    onPress={() => setApplied(item)}
                    disabled={!photo}
                    accessibilityRole="button"
                    style={[
                      styles.smallAction,
                      {
                        backgroundColor: colors.surfaceAlt,
                        borderRadius: radius.sm,
                        opacity: photo ? 1 : 0.4,
                      },
                    ]}
                  >
                    <Text variant="caption" weight="medium">
                      {t.visualizer.applyToPhoto}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => router.push(`/(app)/market/${item.productId}`)}
                    accessibilityRole="button"
                    style={[styles.smallAction, { backgroundColor: colors.primarySoft, borderRadius: radius.sm }]}
                  >
                    <Text variant="caption" weight="medium" tone="primary">
                      {t.market.specs}
                    </Text>
                  </Pressable>
                </View>
              </Card>
            ))
          )}
        </View>
      ) : null}
    </Screen>
  );
}

function OptionGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text variant="small" weight="bold" tone="muted">
        {title}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  preview: { overflow: 'hidden' },
  photo: { height: 220, width: '100%' },
  placeholder: { alignItems: 'center', gap: spacing.sm, height: 220, justifyContent: 'center' },
  overlay: { bottom: 0, height: '38%', justifyContent: 'flex-end', left: 0, position: 'absolute', right: 0 },
  overlayLabel: { color: '#101010', padding: spacing.md },
  photoActions: { gap: spacing.md },
  flex: { flex: 1 },
  group: { gap: spacing.sm },
  chips: { gap: spacing.sm, paddingVertical: 2 },
  results: { gap: spacing.md },
  resultRow: { gap: spacing.md },
  resultInfo: { flex: 1, gap: spacing.xs },
  resultActions: { gap: spacing.sm, marginTop: spacing.md },
  smallAction: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
