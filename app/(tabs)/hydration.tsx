/**
 * Hydration.
 *
 * Quick-add buttons for the amounts the specification names. The app records and totals;
 * it says nothing about whether the number is good, because `FEATURES/HEALTH.md` requires
 * this feature to avoid medical claims.
 */

import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, StateView } from '@/components/Layout';
import {
  useAddWater,
  useHydration,
  useRemoveWater,
  useToday,
  useWaterLogs,
} from '@/features/health/hooks/useHealth';
import { QUICK_ADD_ML, formatVolume } from '@/health/units';
import { useTheme } from '@/theme/ThemeProvider';

export default function HydrationScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const date = useToday();

  const day = useHydration(date);
  const logs = useWaterLogs(date);
  const addWater = useAddWater();
  const remove = useRemoveWater();

  const refreshAll = useCallback(async () => {
    await day.refresh();
    await logs.refresh();
  }, [day, logs]);

  const data = day.data;
  const pending = addWater.pending;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xl,
        }}
      >
        <AppText variant="display" accessibilityRole="header">
          Hydration
        </AppText>

        <Spacer size="lg" />

        {day.status === 'loading' || !data ? (
          <StateView state="loading" loadingLabel="Loading hydration" />
        ) : (
          <>
            <Card>
              <AppText variant="subheading">
                {formatVolume(data.totalMl)} of {formatVolume(data.targetMl)}
              </AppText>
              <Spacer size="xs" />

              {/* Stated in words as well as a bar: a screen reader must not be handed a
                  bare percentage, and the bar must not be the only signal. */}
              <AppText variant="caption" tone="muted">
                {data.percent}% of your daily amount logged
              </AppText>

              <Spacer size="md" />
              <View
                style={[
                  styles.track,
                  { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.pill },
                ]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <View
                  style={[
                    styles.fill,
                    {
                      backgroundColor: theme.colors.accent,
                      borderRadius: theme.radii.pill,
                      width: `${data.percent}%`,
                    },
                  ]}
                />
              </View>
            </Card>

            <Spacer size="md" />

            <Card>
              <AppText variant="subheading">Quick add</AppText>
              <Spacer size="xs" />
              <View style={styles.row}>
                {QUICK_ADD_ML.map((ml) => (
                  <Button
                    key={ml}
                    label={`${ml}`}
                    variant="secondary"
                    onPress={() => {
                      void addWater.run(ml).then(refreshAll);
                    }}
                    disabled={pending}
                    accessibilityHint={`Add ${ml} millilitres`}
                    testID={`quick-add-${ml}`}
                  />
                ))}
              </View>
            </Card>

            <Spacer size="md" />

            <AppText variant="subheading">Today</AppText>
            <Spacer size="xs" />

            {logs.status === 'loading' ? (
              <StateView state="loading" compact loadingLabel="Loading entries" />
            ) : (logs.data ?? []).length === 0 ? (
              <Card>
                <AppText variant="caption" tone="muted">
                  Nothing logged yet today.
                </AppText>
              </Card>
            ) : (
              <View style={{ gap: theme.spacing.xs }}>
                {(logs.data ?? []).map((log) => (
                  <Card key={log.id} flush>
                    <View style={styles.row}>
                      <AppText variant="subheading">{formatVolume(log.amountMl)}</AppText>
                      <Button
                        label="Remove"
                        variant="ghost"
                        size="compact"
                        onPress={() => {
                          void remove.run(log.id).then(refreshAll);
                        }}
                        accessibilityHint={`Remove the ${formatVolume(log.amountMl)} entry`}
                      />
                    </View>
                  </Card>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  track: {
    height: 6,
    overflow: 'hidden',
  },
  fill: {
    height: 6,
  },
});
