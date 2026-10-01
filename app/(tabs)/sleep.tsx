/**
 * Sleep.
 *
 * Shows what has been logged and a plain summary of it. "Consistency" is presented as the
 * observed night-to-night spread in minutes, not as a score: a number that tells the user
 * something actionable without implying whether their sleep is good or bad.
 */

import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, StateView } from '@/components/Layout';
import { TextField } from '@/components/TextField';
import {
  useRemoveSleep,
  useSleepReport,
  useToday,
} from '@/features/health/hooks/useHealth';
import { describeSleepWindow } from '@/services/healthService';
import * as sleepService from '@/services/healthService';
import { isValidationError } from '@/services/errors';
import { formatDuration } from '@/health/sleepMath';
import { useTheme } from '@/theme/ThemeProvider';

export default function SleepScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const date = useToday();

  const report = useSleepReport(date, 14);
  const removeSleep = useRemoveSleep();

  const [bedtime, setBedtime] = useState('');
  const [wakeTime, setWakeTime] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setErrors({});
    setSaving(true);
    try {
      // Called directly rather than through `useAction` so the `ValidationError` reaches
      // this handler and can be attached to the offending field.
      await sleepService.logSleep({ bedtime, wakeTime });
      setBedtime('');
      setWakeTime('');
      await report.refresh();
    } catch (error) {
      if (isValidationError(error)) {
        setErrors(error.fields as Record<string, string>);
        return;
      }
      setErrors({ bedtime: 'That night could not be saved.' });
    } finally {
      setSaving(false);
    }
  }, [bedtime, report, wakeTime]);

  const data = report.data;

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
          Sleep
        </AppText>

        <Spacer size="lg" />

        <Card>
          <AppText variant="subheading">Log last night</AppText>
          <Spacer size="xs" />
          <AppText variant="caption" tone="muted">
            Times are for the morning you woke up. A bedtime later than your wake time is
            taken as the previous evening.
          </AppText>

          <Spacer size="md" />
          <TextField
            label="Bedtime"
            value={bedtime}
            onChangeText={setBedtime}
            placeholder="23:00"
            keyboardType="numbers-and-punctuation"
            error={errors.bedtime}
            testID="sleep-bedtime"
          />
          <Spacer size="sm" />
          <TextField
            label="Wake time"
            value={wakeTime}
            onChangeText={setWakeTime}
            placeholder="07:00"
            keyboardType="numbers-and-punctuation"
            error={errors.wakeTime ?? errors.duration}
            testID="sleep-wake"
          />

          <Spacer size="md" />
          <Button
            label="Save night"
            onPress={() => void save()}
            disabled={saving}
            fullWidth
            testID="sleep-save"
          />
        </Card>

        <Spacer size="md" />

        {report.status === 'loading' || !data ? (
          <StateView state="loading" loadingLabel="Loading sleep" />
        ) : data.nights === 0 ? (
          <Card>
            <AppText variant="caption" tone="muted">
              No nights logged in the last two weeks.
            </AppText>
          </Card>
        ) : (
          <>
            <Card>
              <AppText variant="subheading">
                {data.nights === 1 ? '1 night' : `${data.nights} nights`} logged
              </AppText>
              <Spacer size="xs" />
              <AppText variant="caption" tone="muted">
                Average {formatDuration(data.averageMinutes)}
                {data.consistencyMinutes === null
                  ? ' · log a few more nights to see the spread'
                  : ` · ${formatDuration(data.consistencyMinutes)} between shortest and longest`}
              </AppText>
            </Card>

            <Spacer size="md" />
            <AppText variant="subheading">Recent</AppText>
            <Spacer size="xs" />

            <View style={{ gap: theme.spacing.xs }}>
              {data.logs.map((log) => (
                <Card key={log.id} flush>
                  <View style={styles.row}>
                    <View style={styles.details}>
                      <AppText variant="subheading">{formatDuration(log.durationMin)}</AppText>
                      <AppText variant="caption" tone="muted">
                        {log.sleepDate} · {describeSleepWindow(log)}
                        {log.quality === null ? '' : ` · quality ${log.quality}/10`}
                      </AppText>
                    </View>
                    <Button
                      label="Remove"
                      variant="ghost"
                      size="compact"
                      onPress={() => {
                        void removeSleep.run(log.id).then(() => void report.refresh());
                      }}
                      accessibilityHint={`Remove the night of ${log.sleepDate}`}
                    />
                  </View>
                </Card>
              ))}
            </View>
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
  },
  details: {
    flexShrink: 1,
    gap: 2,
  },
});
