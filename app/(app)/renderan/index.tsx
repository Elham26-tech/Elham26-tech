import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { listRenderProjects, listTextures, suggestStones, uploadTexture } from '@/api/services';
import type {
  DurabilityLevel,
  RenderProject,
  Texture,
  VisualizerStyle,
  VisualizerSuggestion,
} from '@/api/types';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ProgressBar,
  RenderPreview,
  Screen,
  SectionHeader,
  StoneSwatch,
  Text,
  TextField,
} from '@/components';
import { useAsync } from '@/lib/useAsync';
import { useFormatters } from '@/lib/usePrice';
import { moduleColors, radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

const STYLES: VisualizerStyle[] = ['modern', 'classic', 'minimal', 'luxury', 'rustic'];
const DURABILITY: DurabilityLevel[] = ['standard', 'high', 'extreme'];

/** Neutral tints offered for an uploaded texture until the image is analysed. */
const UPLOAD_TINTS = ['#D9CFC0', '#E8D8BE', '#B9BCC2', '#5B5F66', '#2B2B2F', '#F0E6D2'];

export default function RenderanScreen() {
  const { t, colors, isRtl, language } = useTheme();
  const { num } = useFormatters();

  const projects = useAsync(() => listRenderProjects(), []);
  const [textureNonce, setTextureNonce] = useState(0);
  const textures = useAsync(() => listTextures(), [textureNonce]);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [textureId, setTextureId] = useState<string | null>(null);

  const [pendingUpload, setPendingUpload] = useState<{ uri: string; tint: string } | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploading, setUploading] = useState(false);

  const [style, setStyle] = useState<VisualizerStyle>('modern');
  const [durability, setDurability] = useState<DurabilityLevel>('high');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<VisualizerSuggestion[] | null>(null);

  // Open on the first project so the stage is never empty.
  useEffect(() => {
    if (!projectId && projects.data?.[0]) setProjectId(projects.data[0].id);
  }, [projects.data, projectId]);

  const project: RenderProject | null = useMemo(
    () => (projects.data ?? []).find((p) => p.id === projectId) ?? projects.data?.[0] ?? null,
    [projects.data, projectId],
  );
  const texture: Texture | null = useMemo(
    () => (textures.data ?? []).find((tx) => tx.id === textureId) ?? null,
    [textures.data, textureId],
  );

  const myTextures = (textures.data ?? []).filter((tx) => tx.uploadedByMe);
  const catalogueTextures = (textures.data ?? []).filter((tx) => !tx.uploadedByMe);

  const pickTextureImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.9, mediaTypes: ['images'] });
    if (!result.canceled && result.assets[0]) {
      setPendingUpload({
        uri: result.assets[0].uri,
        tint: UPLOAD_TINTS[Math.floor(Math.random() * UPLOAD_TINTS.length)],
      });
      setUploadName('');
    }
  };

  const confirmUpload = async () => {
    if (!pendingUpload) return;
    setUploading(true);
    try {
      const created = await uploadTexture({
        title: uploadName.trim() || t.renderan.textureName,
        imageUri: pendingUpload.uri,
        colorHex: pendingUpload.tint,
      });
      setPendingUpload(null);
      setUploadName('');
      setTextureNonce((n) => n + 1);
      setTextureId(created.id);
    } finally {
      setUploading(false);
    }
  };

  const runSuggestion = async () => {
    if (!project) return;
    setSuggesting(true);
    try {
      setSuggestions(await suggestStones({ style, space: project.space, durability }));
    } finally {
      setSuggesting(false);
    }
  };

  if (projects.loading || !project) {
    return (
      <Screen>
        <EmptyState title={t.common.loading} loading />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={styles.content}>
      <Text variant="small" tone="muted">
        {t.renderan.subtitle}
      </Text>

      <RenderPreview project={project} texture={texture} />

      {!texture ? (
        <Text variant="caption" tone="amber" center>
          {t.renderan.pickTexture}
        </Text>
      ) : null}

      <View>
        <SectionHeader title={t.renderan.projects} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {(projects.data ?? []).map((item) => {
            const selected = item.id === project.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => setProjectId(item.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[
                  styles.projectCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: selected ? moduleColors.renderan : colors.border,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <View style={[styles.projectThumb, { backgroundColor: item.sceneColor }]}>
                  <View style={[styles.projectThumbBar, { backgroundColor: item.accentColor }]} />
                </View>
                <Text variant="caption" weight={selected ? 'bold' : 'regular'} numberOfLines={2}>
                  {language === 'fa' ? item.title : item.titleEn}
                </Text>
                <Text variant="caption" tone="faint">
                  {t.renderan.surfaces[item.surface]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View>
        <SectionHeader title={t.renderan.textures} />

        {pendingUpload ? (
          <Card accentColor={moduleColors.renderan} style={styles.uploadCard}>
            <View style={[styles.uploadRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
              <StoneSwatch color={pendingUpload.tint} size={56} />
              <TextField
                label={t.renderan.textureName}
                value={uploadName}
                onChangeText={setUploadName}
                containerStyle={styles.flex}
              />
            </View>
            <View style={[styles.uploadActions, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
              <Button
                label={uploading ? t.renderan.uploading : t.common.confirm}
                onPress={() => void confirmUpload()}
                loading={uploading}
                style={styles.flex}
              />
              <Button
                label={t.common.cancel}
                onPress={() => setPendingUpload(null)}
                variant="ghost"
                style={styles.flex}
              />
            </View>
          </Card>
        ) : (
          <Button
            label={`＋  ${t.renderan.uploadTexture}`}
            onPress={() => void pickTextureImage()}
            variant="secondary"
            style={styles.uploadCard}
          />
        )}

        {myTextures.length > 0 ? (
          <>
            <Text variant="small" tone="muted" weight="medium" style={styles.groupLabel}>
              {t.renderan.myTextures}
            </Text>
            <TextureRow
              textures={myTextures}
              selectedId={textureId}
              onSelect={setTextureId}
              language={language}
            />
          </>
        ) : null}

        <Text variant="small" tone="muted" weight="medium" style={styles.groupLabel}>
          {t.renderan.catalogue}
        </Text>
        <TextureRow
          textures={catalogueTextures}
          selectedId={textureId}
          onSelect={setTextureId}
          language={language}
        />
      </View>

      <Card accentColor={moduleColors.renderan}>
        <Text variant="title" weight="bold">
          {t.renderan.suggest}
        </Text>
        <Text variant="caption" tone="muted" style={styles.groupLabel}>
          {t.renderan.suggestDesc}
        </Text>

        <Text variant="small" tone="muted" weight="medium" style={styles.groupLabel}>
          {t.renderan.style}
        </Text>
        <View style={[styles.chips, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          {STYLES.map((key) => (
            <Chip
              key={key}
              label={t.renderan.styles[key]}
              selected={style === key}
              color={moduleColors.renderan}
              onPress={() => setStyle(key)}
            />
          ))}
        </View>

        <Text variant="small" tone="muted" weight="medium" style={styles.groupLabel}>
          {t.renderan.durability}
        </Text>
        <View style={[styles.chips, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          {DURABILITY.map((key) => (
            <Chip
              key={key}
              label={t.renderan.durabilityLevels[key]}
              selected={durability === key}
              color={moduleColors.renderan}
              onPress={() => setDurability(key)}
            />
          ))}
        </View>

        <Button
          label={suggesting ? t.renderan.analyzing : t.renderan.analyze}
          onPress={() => void runSuggestion()}
          loading={suggesting}
          style={styles.suggestButton}
        />
      </Card>

      {suggestions ? (
        <View style={styles.results}>
          <SectionHeader title={t.renderan.results} />
          {suggestions.map((item) => (
            <Card key={item.productId}>
              <View style={[styles.resultRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                <StoneSwatch color={item.colorHex} size={64} />
                <View style={styles.resultInfo}>
                  <Text variant="body" weight="bold" numberOfLines={1}>
                    {language === 'fa' ? item.title : item.titleEn}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {t.renderan.matchScore}: {num(item.matchScore)}٪
                  </Text>
                  <ProgressBar value={item.matchScore / 100} color={moduleColors.renderan} />
                  <Text variant="caption" tone="faint">
                    {language === 'fa' ? item.reason : item.reasonEn}
                  </Text>
                </View>
              </View>

              <View style={[styles.resultActions, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
                <Pressable
                  onPress={() => setTextureId(`tx-${item.productId}`)}
                  accessibilityRole="button"
                  style={[styles.smallAction, { backgroundColor: colors.primarySoft, borderRadius: radius.sm }]}
                >
                  <Text variant="caption" weight="medium" tone="primary">
                    {t.renderan.useTexture}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => router.push(`/(app)/market/${item.productId}`)}
                  accessibilityRole="button"
                  style={[styles.smallAction, { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm }]}
                >
                  <Text variant="caption" weight="medium">
                    {t.market.specs}
                  </Text>
                </Pressable>
              </View>
            </Card>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

function TextureRow({
  textures,
  selectedId,
  onSelect,
  language,
}: {
  textures: Texture[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  language: 'fa' | 'en';
}) {
  const { colors } = useTheme();

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {textures.map((item) => {
        const selected = item.id === selectedId;
        return (
          <Pressable
            key={item.id}
            onPress={() => onSelect(item.id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[
              styles.textureCard,
              {
                borderColor: selected ? moduleColors.renderan : colors.border,
                borderRadius: radius.md,
              },
            ]}
          >
            <StoneSwatch color={item.colorHex} size={64} style={styles.textureSwatch} />
            <Text variant="caption" weight={selected ? 'bold' : 'regular'} numberOfLines={2}>
              {language === 'fa' ? item.title : item.titleEn}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  row: { gap: spacing.sm, paddingVertical: spacing.xs },
  projectCard: {
    borderWidth: StyleSheet.hairlineWidth * 3,
    gap: 2,
    padding: spacing.sm,
    width: 128,
  },
  projectThumb: { borderRadius: 6, height: 62, justifyContent: 'flex-end', marginBottom: spacing.xs, overflow: 'hidden' },
  projectThumbBar: { height: 14, opacity: 0.5, width: '100%' },
  textureCard: { borderWidth: StyleSheet.hairlineWidth * 3, gap: 2, padding: spacing.sm, width: 92 },
  textureSwatch: { marginBottom: spacing.xs, width: '100%' },
  uploadCard: { marginBottom: spacing.md },
  uploadRow: { alignItems: 'flex-end', gap: spacing.md },
  uploadActions: { gap: spacing.md, marginTop: spacing.md },
  groupLabel: { marginBottom: spacing.sm, marginTop: spacing.sm },
  chips: { flexWrap: 'wrap', gap: spacing.sm },
  suggestButton: { marginTop: spacing.lg },
  flex: { flex: 1 },
  results: { gap: spacing.md },
  resultRow: { gap: spacing.md },
  resultInfo: { flex: 1, gap: spacing.xs },
  resultActions: { gap: spacing.sm, marginTop: spacing.md },
  smallAction: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
