import { router } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { countries } from '@/api/fixtures';
import { createRfq } from '@/api/services';
import type { Incoterm, Rfq } from '@/api/types';
import { Button, Card, Chip, Screen, Text, TextField } from '@/components';
import { toLatinDigits } from '@/lib/format';
import { spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';

const INCOTERMS: Incoterm[] = ['EXW', 'FOB', 'CFR', 'CIF', 'DAP'];
const UNITS: Rfq['unit'][] = ['m2', 'ton', 'container'];

const UNIT_LABELS: Record<Rfq['unit'], { fa: string; en: string }> = {
  m2: { fa: 'متر مربع', en: 'm²' },
  ton: { fa: 'تن', en: 'ton' },
  container: { fa: 'کانتینر', en: 'container' },
};

export default function RfqScreen() {
  const { t, isRtl, language } = useTheme();

  const [product, setProduct] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<Rfq['unit']>('m2');
  const [country, setCountry] = useState<string>('CN');
  const [incoterm, setIncoterm] = useState<Incoterm>('FOB');
  const [targetPrice, setTargetPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await createRfq({
        productTitle: product.trim(),
        quantity: Number(toLatinDigits(quantity).replace(/\D/g, '')) || 0,
        unit,
        destinationCountry: country,
        incoterm,
        targetPrice: targetPrice ? Number(toLatinDigits(targetPrice).replace(/\D/g, '')) : undefined,
        notes: notes.trim() || undefined,
      });
      setDone(true);
      setTimeout(() => router.back(), 1200);
    } catch {
      setError(t.common.error);
    } finally {
      setSubmitting(false);
    }
  };

  const valid = product.trim().length > 1 && Number(toLatinDigits(quantity).replace(/\D/g, '')) > 0;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen contentStyle={styles.content}>
        <TextField label={t.trade.product} value={product} onChangeText={setProduct} />

        <TextField
          label={t.trade.quantity}
          value={quantity}
          onChangeText={(text) => setQuantity(toLatinDigits(text).replace(/\D/g, ''))}
          keyboardType="number-pad"
        />

        <Field label={t.trade.unit}>
          {UNITS.map((key) => (
            <Chip
              key={key}
              label={UNIT_LABELS[key][language]}
              selected={unit === key}
              onPress={() => setUnit(key)}
            />
          ))}
        </Field>

        <Field label={t.trade.destinationCountry}>
          {countries.map((item) => (
            <Chip
              key={item.code}
              label={`${item.flag} ${language === 'fa' ? item.fa : item.en}`}
              selected={country === item.code}
              onPress={() => setCountry(item.code)}
            />
          ))}
        </Field>

        <Field label={t.trade.incoterm}>
          {INCOTERMS.map((key) => (
            <Chip key={key} label={key} selected={incoterm === key} onPress={() => setIncoterm(key)} />
          ))}
        </Field>

        <TextField
          label={t.trade.targetPrice}
          value={targetPrice}
          onChangeText={(text) => setTargetPrice(toLatinDigits(text).replace(/\D/g, ''))}
          keyboardType="number-pad"
          hint={t.common.currency}
        />

        <TextField
          label={t.trade.notes}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={4}
          style={styles.notes}
        />

        {done ? (
          <Card>
            <Text variant="small" tone="green" center weight="medium">
              ✓ {t.trade.rfqCreated}
            </Text>
          </Card>
        ) : null}

        {error ? (
          <Text variant="small" tone="red" center>
            {error}
          </Text>
        ) : null}

        <Button
          label={t.common.submit}
          onPress={() => void submit()}
          loading={submitting}
          disabled={!valid || done}
          size="lg"
        />
      </Screen>
    </KeyboardAvoidingView>
  );

  function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <View style={styles.field}>
        <Text variant="small" tone="muted" weight="medium">
          {label}
        </Text>
        <View style={[styles.chips, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>{children}</View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { gap: spacing.lg },
  field: { gap: spacing.sm },
  chips: { flexWrap: 'wrap', gap: spacing.sm },
  notes: { minHeight: 96, textAlignVertical: 'top' },
});
