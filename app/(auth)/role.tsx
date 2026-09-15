import { router } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';

import type { UserRole } from '@/api/types';
import { Button, Screen, Text, TextField } from '@/components';
import { useAuthStore } from '@/store/auth';
import { moduleColors, radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

const ROLES: { key: UserRole; color: string; emoji: string }[] = [
  { key: 'producer', color: moduleColors.mine, emoji: '⛏️' },
  { key: 'buyer', color: moduleColors.market, emoji: '🏗️' },
  { key: 'marketer', color: moduleColors.affiliate, emoji: '📣' },
];

export default function RoleScreen() {
  const { t, colors } = useTheme();
  const finishProfile = useAuthStore((s) => s.finishProfile);

  const [role, setRole] = useState<UserRole>('buyer');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      await finishProfile({ name: name.trim(), company: company.trim() || undefined, role });
      router.replace('/(app)');
    } catch {
      setError(t.common.error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen contentStyle={styles.content}>
        <View style={styles.header}>
          <Text variant="heading" weight="bold">
            {t.auth.roleTitle}
          </Text>
          <Text variant="small" tone="muted">
            {t.auth.roleSubtitle}
          </Text>
        </View>

        <View style={styles.roles}>
          {ROLES.map((option) => {
            const selected = role === option.key;
            return (
              <Pressable
                key={option.key}
                onPress={() => setRole(option.key)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[
                  styles.role,
                  {
                    backgroundColor: selected ? `${option.color}1F` : colors.surface,
                    borderColor: selected ? option.color : colors.border,
                    borderRadius: radius.lg,
                  },
                ]}
              >
                <Text variant="heading">{option.emoji}</Text>
                <View style={styles.roleText}>
                  <Text variant="body" weight="bold">
                    {t.roles[option.key]}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {t.roles[`${option.key}Desc` as const]}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.form}>
          <TextField
            label={t.auth.nameLabel}
            value={name}
            onChangeText={setName}
            autoComplete="name"
            textContentType="name"
          />
          <TextField label={t.auth.companyLabel} value={company} onChangeText={setCompany} />
        </View>

        {error ? (
          <Text variant="small" tone="red" center>
            {error}
          </Text>
        ) : null}

        <Button
          label={t.auth.finish}
          onPress={() => void onSubmit()}
          loading={loading}
          disabled={name.trim().length < 2}
          size="lg"
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { gap: spacing.xl, justifyContent: 'center', minHeight: '100%' },
  header: { gap: spacing.sm },
  roles: { gap: spacing.md },
  role: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth * 3,
    flexDirection: 'row',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  roleText: { flex: 1, gap: 2 },
  form: { gap: spacing.md },
});
