/**
 * Currency and exchange rates.
 *
 * `FEATURES/FINANCE.md` requires PHP, USD, EUR and custom currencies, and requires finance
 * records to stay local. Those two constraints together mean there is no rate feed: a
 * rate here is one the user typed, and the screen is explicit about that rather than
 * implying the number is current.
 *
 * Storing both directions of a pair is the service's job, not this screen's — the editor
 * shows one row per unordered pair so a user cannot accidentally set two contradicting
 * rates for the same two currencies.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, Section, StateView } from '@/components/Layout';
import { TextField } from '@/components/TextField';
import {
  useClearExchangeRate,
  useExchangeRates,
  useSetExchangeRate,
} from '@/features/finance/hooks/useFinance';
import { useSettingsValue, useUpdateSettings } from '@/features/settings/hooks/useSettingsActions';
import {
  CURRENCY_PRESETS,
  currencyName,
  formatRate,
  normaliseCurrencyCode,
} from '@/services/exchangeRateService';
import { isValidationError } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

export default function CurrencySettingsScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const settings = useSettingsValue();
  const update = useUpdateSettings();
  const stored = useExchangeRates();
  const setRate = useSetExchangeRate();
  const clearRate = useClearExchangeRate();

  const [customCode, setCustomCode] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rate, setRateInput] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  /**
   * One row per unordered pair.
   *
   * The service stores both directions, so reading the map directly would show every rate
   * twice. Sorting the codes within each key is what makes `USD_EUR` and `EUR_USD` land in
   * the same row.
   */
  const pairs = useMemo(() => {
    const out: { from: string; to: string; micro: number; label: string }[] = [];

    for (const [key, micro] of Object.entries(stored.data ?? {})) {
      const [a, b] = key.split('_');
      if (!a || !b) continue;
      const [fromCode, toCode] = a < b ? [a, b] : [b, a];
      // Only render one direction of each pair: the one whose key is sorted.
      if (a !== fromCode) continue;
      out.push({ from: fromCode, to: toCode, micro, label: formatRate(micro) });
    }

    return out.sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
  }, [stored.data]);

  const addCustom = useCallback(async () => {
    setErrors({});
    const code = normaliseCurrencyCode(customCode);
    if (!code) {
      setErrors({ customCode: 'Use a three-letter code such as CHF.' });
      return;
    }
    try {
      await update.run({ currency: code });
      setCustomCode('');
    } catch {
      setErrors({ customCode: 'That currency could not be saved.' });
    }
  }, [customCode, update]);

  const saveRate = useCallback(async () => {
    setErrors({});
    try {
      await setRate.run({ from, to, rate });
      setRateInput('');
    } catch (error) {
      if (isValidationError(error)) {
        setErrors(error.fields as Record<string, string>);
        return;
      }
      setErrors({ rate: 'That rate could not be saved.' });
    }
  }, [from, rate, setRate, to]);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <AppText variant="display" accessibilityRole="header">
          Currency
        </AppText>
        <Spacer size="xs" />
        <AppText variant="caption" tone="muted">
          LifeOS never looks up exchange rates online. Enter the rate you want to use and it
          applies until you change it, so a converted total is always explainable.
        </AppText>

        <Spacer size="lg" />

        <Section title="Home currency">
          <Card>
            <AppText variant="caption" tone="muted">
              Budgets and your combined balance use this. {settings.currency} is currently
              home.
            </AppText>
            <Spacer size="sm" />
            <View style={styles.wrapRow}>
              {CURRENCY_PRESETS.map((preset) => (
                <View key={preset.code} style={styles.chip}>
                  <Button
                    label={preset.code}
                    accessibilityLabel={`${preset.code}, ${preset.name}`}
                    onPress={() => void update.run({ currency: preset.code })}
                    variant={settings.currency === preset.code ? 'primary' : 'secondary'}
                    size="compact"
                    selected={settings.currency === preset.code}
                    testID={`currency-home-${preset.code}`}
                  />
                </View>
              ))}
            </View>
            <Spacer size="sm" />
            <TextField
              label="Any other ISO code"
              value={customCode}
              onChangeText={setCustomCode}
              placeholder="CHF"
              autoCapitalize="characters"
              error={errors.customCode}
              testID="currency-custom"
            />
            <Spacer size="sm" />
            <Button
              label="Use this currency"
              onPress={addCustom}
              variant="secondary"
              loading={update.pending}
              disabled={customCode.trim().length !== 3}
              fullWidth
              testID="currency-custom-save"
            />
          </Card>
        </Section>

        <Spacer size="lg" />

        <Section title="Add a rate">
          <Card>
            <TextField
              label="From"
              value={from}
              onChangeText={setFrom}
              placeholder="USD"
              autoCapitalize="characters"
              error={errors.from}
              testID="rate-from"
            />
            <Spacer size="sm" />
            <TextField
              label="To"
              value={to}
              onChangeText={setTo}
              placeholder="PHP"
              autoCapitalize="characters"
              error={errors.to}
              testID="rate-to"
            />
            <Spacer size="sm" />
            <TextField
              label="1 of the first is worth this many of the second"
              value={rate}
              onChangeText={setRateInput}
              placeholder="58.25"
              keyboardType="decimal-pad"
              error={errors.rate}
              testID="rate-value"
            />
            <Spacer size="md" />
            <Button
              label="Save rate"
              onPress={saveRate}
              loading={setRate.pending}
              disabled={from.trim() === '' || to.trim() === '' || rate.trim() === ''}
              fullWidth
              testID="rate-save"
            />
          </Card>
        </Section>

        <Section title="Saved rates">
          {stored.status === 'loading' ? (
            <StateView state="loading" compact loadingLabel="Loading rates" />
          ) : pairs.length === 0 ? (
            <StateView
              state="empty"
              compact
              emptyTitle="No rates set"
              emptyBody="Accounts in other currencies are left out of the combined balance until you add one."
            />
          ) : (
            <Card flush>
              {pairs.map((pair, index) => (
                <View key={`${pair.from}_${pair.to}`}>
                  {index > 0 && <View style={styles.divider} />}
                  <View style={styles.row}>
                    <View style={styles.grow}>
                      <AppText variant="body">
                        {pair.from} → {pair.to}
                      </AppText>
                      <AppText variant="caption" tone="muted">
                        1 {pair.from} = {pair.label} {pair.to} ·{' '}
                        {currencyName(pair.from)} to {currencyName(pair.to)}
                      </AppText>
                    </View>
                    <Button
                      label="Remove"
                      variant="ghost"
                      size="compact"
                      onPress={() => void clearRate.run(pair.from, pair.to)}
                      accessibilityHint={`Remove the rate between ${pair.from} and ${pair.to}`}
                      testID={`rate-remove-${pair.from}-${pair.to}`}
                    />
                  </View>
                </View>
              ))}
            </Card>
          )}
        </Section>

        {clearRate.error || setRate.error ? (
          <>
            <Spacer size="md" />
            <StateView
              state="error"
              errorMessage={clearRate.error?.message ?? setRate.error?.message ?? null}
            />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { marginRight: 8, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  grow: { flex: 1 },
  divider: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.2,
    marginHorizontal: 16,
  },
});
