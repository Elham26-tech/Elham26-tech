import Constants from 'expo-constants';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Chip, Screen, Text } from '@/components';
import { formatMobile } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { useSettingsStore } from '@/store/settings';
import type { Language } from '@/i18n';
import type { ThemeMode } from '@/theme';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

export default function ProfileScreen() {
  const { t, colors, isRtl, language, mode } = useTheme();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const favorites = useSettingsStore((s) => s.favorites);

  const links: { label: string; emoji: string; href: string }[] = [
    { label: t.profile.myOrders, emoji: '📦', href: '/logistics' },
    { label: t.profile.myBids, emoji: '🔨', href: '/(app)/auction' },
    { label: t.trade.myRfqs, emoji: '🌍', href: '/trade' },
    { label: t.affiliate.title, emoji: '📣', href: '/affiliate' },
    { label: t.mine.title, emoji: '⛏️', href: '/mine' },
  ];

  const languages: { key: Language; label: string }[] = [
    { key: 'fa', label: 'فارسی' },
    { key: 'en', label: 'English' },
  ];
  const themes: { key: ThemeMode; label: string }[] = [
    { key: 'dark', label: t.profile.themeDark },
    { key: 'light', label: t.profile.themeLight },
  ];

  return (
    <Screen contentStyle={styles.content}>
      <Card>
        <View style={[styles.identity, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <View style={[styles.avatar, { backgroundColor: user?.avatarColor ?? colors.primary }]}>
            <Text variant="heading" weight="bold" tone="inverse">
              {(user?.name ?? '؟').trim().charAt(0) || '؟'}
            </Text>
          </View>
          <View style={styles.identityText}>
            <Text variant="title" weight="bold">
              {user?.name || t.common.appName}
            </Text>
            <Text variant="small" tone="muted">
              {user ? formatMobile(user.phone, language) : ''}
            </Text>
            {user?.company ? (
              <Text variant="caption" tone="faint">
                {user.company}
              </Text>
            ) : null}
            {user ? <Badge label={t.roles[user.role]} color={colors.primary} style={styles.badge} /> : null}
          </View>
        </View>
      </Card>

      <Card padded={false}>
        {links.map((link, index) => (
          <Pressable
            key={link.label}
            onPress={() => router.push(link.href as never)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.link,
              {
                borderBottomColor: colors.border,
                borderBottomWidth: index === links.length - 1 ? 0 : StyleSheet.hairlineWidth,
                flexDirection: isRtl ? 'row-reverse' : 'row',
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text variant="body">{link.emoji}</Text>
            <Text variant="body" weight="medium" style={styles.flex}>
              {link.label}
            </Text>
            <Text variant="body" tone="faint">
              {isRtl ? '‹' : '›'}
            </Text>
          </Pressable>
        ))}
      </Card>

      <Card>
        <Text variant="title" weight="bold" style={styles.sectionTitle}>
          {t.profile.settings}
        </Text>

        <Text variant="small" tone="muted" style={styles.settingLabel}>
          {t.profile.language}
        </Text>
        <View style={[styles.chipRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          {languages.map((item) => (
            <Chip
              key={item.key}
              label={item.label}
              selected={language === item.key}
              onPress={() => setLanguage(item.key)}
            />
          ))}
        </View>

        <Text variant="small" tone="muted" style={styles.settingLabel}>
          {t.profile.theme}
        </Text>
        <View style={[styles.chipRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          {themes.map((item) => (
            <Chip
              key={item.key}
              label={item.label}
              selected={mode === item.key}
              onPress={() => setTheme(item.key)}
            />
          ))}
        </View>

        <View style={[styles.favRow, { borderTopColor: colors.border, flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
          <Text variant="small" tone="muted">
            {t.profile.favorites}
          </Text>
          <Text variant="small" weight="bold">
            {favorites.length}
          </Text>
        </View>
      </Card>

      <View style={styles.footer}>
        <Button label={t.auth.logout} onPress={() => void signOut()} variant="danger" />
        <Text variant="caption" tone="faint" center>
          {t.profile.version} {Constants.expoConfig?.version ?? '0.1.0'}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  identity: { alignItems: 'center', gap: spacing.lg },
  avatar: { alignItems: 'center', borderRadius: radius.pill, height: 60, justifyContent: 'center', width: 60 },
  identityText: { flex: 1, gap: 2 },
  badge: { marginTop: spacing.xs },
  link: { alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
  flex: { flex: 1 },
  sectionTitle: { marginBottom: spacing.md },
  settingLabel: { marginBottom: spacing.sm, marginTop: spacing.sm },
  chipRow: { gap: spacing.sm },
  favRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
  },
  footer: { gap: spacing.md },
});
