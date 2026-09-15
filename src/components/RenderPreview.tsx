import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { RenderProject, Texture } from '@/api/types';
import { radius } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';

interface RenderPreviewProps {
  project: RenderProject;
  texture: Texture | null;
  height?: number;
}

/**
 * Renderan's preview stage. A real build hands the project mesh and the texture
 * to the native renderer; here the scene is composed from the project's shell
 * colour with the texture filling the modelled surface, so the pairing reads
 * correctly and the geometry of each scene stays distinguishable.
 */
export function RenderPreview({ project, texture, height = 230 }: RenderPreviewProps) {
  const { colors, t, language } = useTheme();

  // Each surface occupies a different part of the frame, matching its geometry.
  const surfaceStyle = {
    floor: { bottom: 0, left: 0, right: 0, height: `${project.coverage * 100}%` },
    stairs: { bottom: 0, left: 0, right: 0, height: `${project.coverage * 100}%` },
    wall: { top: 0, bottom: 0, left: 0, width: `${project.coverage * 100}%` },
    facade: { top: 0, bottom: 0, left: 0, right: 0, opacity: project.coverage },
    counter: {
      bottom: '18%' as const,
      left: '8%' as const,
      right: '8%' as const,
      height: `${project.coverage * 60}%`,
    },
  }[project.surface] as Record<string, unknown>;

  return (
    <View
      style={[
        styles.stage,
        { backgroundColor: project.sceneColor, borderColor: colors.border, borderRadius: radius.lg, height },
      ]}
    >
      {/* Scene furniture: a horizon line and an accent band give the shell depth. */}
      <View style={[styles.horizon, { backgroundColor: `${project.accentColor}33` }]} />
      <View style={[styles.accent, { backgroundColor: `${project.accentColor}22` }]} />

      {texture ? (
        <View style={[styles.surface, surfaceStyle, { backgroundColor: texture.colorHex }]}>
          {texture.imageUri ? (
            <Image source={{ uri: texture.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <>
              <View style={[styles.vein, styles.veinOne]} />
              <View style={[styles.vein, styles.veinTwo]} />
            </>
          )}
        </View>
      ) : null}

      <View style={[styles.caption, { backgroundColor: colors.overlay }]}>
        <Text variant="caption" weight="bold" tone="inverse">
          {language === 'fa' ? project.title : project.titleEn}
        </Text>
        <Text variant="caption" tone="inverse" style={styles.captionMeta}>
          {t.renderan.surfaceLabel}: {t.renderan.surfaces[project.surface]}
          {texture ? ` · ${language === 'fa' ? texture.title : texture.titleEn}` : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { borderWidth: StyleSheet.hairlineWidth * 2, overflow: 'hidden', width: '100%' },
  horizon: { height: 1, left: 0, position: 'absolute', right: 0, top: '38%' },
  accent: { bottom: '18%', height: 2, left: '12%', position: 'absolute', width: '30%' },
  surface: { overflow: 'hidden', position: 'absolute' },
  vein: { backgroundColor: 'rgba(255,255,255,0.26)', position: 'absolute' },
  veinOne: { height: 2, left: -20, right: -20, top: '30%', transform: [{ rotate: '-9deg' }] },
  veinTwo: { height: 1, left: -20, right: -20, top: '68%', transform: [{ rotate: '6deg' }] },
  caption: { bottom: 0, left: 0, padding: 10, position: 'absolute', right: 0 },
  captionMeta: { opacity: 0.85 },
});
