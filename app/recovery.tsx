/**
 * Recovery.
 *
 * Two things that happen to share a screen: how you said you felt today on a 1-10 scale,
 * and how much stretching, yoga or mobility work you did.
 *
 * Neither is a measurement, and nothing here interprets them. `FEATURES/RECOVERY.md` asks
 * for ratings, and the service layer refuses to turn a rating into advice — a number that
 * says "5" is information about a person's day, not a diagnosis. The report therefore
 * reports means, spreads and how they moved, and stops there.
 */

import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, Section, StateView } from '@/components/Layout';
import { TextField } from '@/components/TextField';
import {
  MOBILITY_KIND_LABELS,
  RATING_HINTS,
  RATING_LABELS,
  RECOVERY_RATINGS,
  useLogMobility,
  useRateDay,
  useRecoveryDay,
  useRecoveryReport,
  useRemoveMobility,
} from '@/features/health/hooks/useRecovery';
import type { MobilityKind, RecoveryRating } from '@/features/health/hooks/useRecovery';
import { formatMinutes, validateSessionMinutes } from '@/health/mobilityMath';
import { isValidationError } from '@/services/errors';
import { useToday } from '@/features/health/hooks/useHealth';
import { useTheme } from '@/theme/ThemeProvider';

const WINDOW_DAYS = 14;

const MOBILITY_ORDER: MobilityKind[] = [
  'stretch',
  'mobility',
  'yoga',
  'foam_roll',
  'breathing',
  'other',
];

/** One-line reading of a rating's movement. Describes, never advises. */
function trendSentence(current: number | null, previous: number | null): string | null {
  if (current === null || previous === null) return null;
  const delta = Math.round((current - previous) * 10) / 10;
  if (delta === 0) return 'the same as the previous fortnight';
  return delta > 0
    ? `up ${Math.abs(delta)} on the previous fortnight`
    : `down ${Math.abs(delta)} on the previous fortnight`;
}

export default function RecoveryScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const today = useToday();

  const todayLog = useRecoveryDay(today);
  const report = useRecoveryReport(today, WINDOW_DAYS);
  const rateDay = useRateDay();
  const logMobility = useLogMobility();
  const removeMobility = useRemoveMobility();

  const [kind, setKind] = useState<MobilityKind>('stretch');
  const [minutes, setMinutes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  /**
   * Writes all four ratings at once.
   *
   * Omitted ratings are cleared rather than preserved, because a half-filled form that
   * silently keeps yesterday's answers is a worse record than an honest blank one.
   */
  const saveRatings = useCallback(
    async (values: Partial<Record<RecoveryRating, number>>) => {
      setErrors({});
      try {
        await rateDay.run({ logDate: today, ...values });
      } catch (error) {
        setErrors(
          isValidationError(error)
            ? (error.fields as Record<string, string>)
            : { form: 'Those ratings could not be saved.' },
        );
      }
    },
    [rateDay, today],
  );

  const rate = useCallback(
    (rating: RecoveryRating, value: number) => {
      void saveRatings({ [rating]: value });
    },
    [saveRatings],
  );

  const saveMobility = useCallback(async () => {
    setErrors({});
    // Validated here as well as in the service so the message lands under the field
    // rather than at the bottom of the screen.
    const problem = validateSessionMinutes(Number(minutes));
    if (problem) {
      setErrors({ minutes: problem });
      return;
    }
    try {
      await logMobility.run({ logDate: today, kind, durationMin: Number(minutes) });
      setMinutes('');
      await report.refresh();
    } catch (error) {
      setErrors(
        isValidationError(error)
          ? (error.fields as Record<string, string>)
          : { minutes: 'That session could not be saved.' },
      );
    }
  }, [kind, logMobility, minutes, report, today]);

  const data = report.data;
  const todayRatings = todayLog.data;
  const energyTrend = data
    ? trendSentence(data.ratings.energy.current, data.ratings.energy.previous)
    : null;

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
          Recovery
        </AppText>
        <Spacer size="xs" />
        <AppText variant="caption" tone="muted">
          How you felt today, and how much mobility work you did. These are your own
          ratings — LifeOS records them without interpreting them.
        </AppText>

        <Spacer size="lg" />

        <Section title="Today">
          <Card>
            {RECOVERY_RATINGS.map((key) => (
              <View key={key} style={styles.ratingBlock}>
                <AppText variant="body">{RATING_LABELS[key]}</AppText>
                <AppText variant="caption" tone="muted">
                  {RATING_HINTS[key]}
                </AppText>
                <Spacer size="sm" />
                <RatingScale
                  value={todayRatings?.[key] ?? null}
                  onChange={(value) => rate(key, value)}
                  label={RATING_LABELS[key]}
                />
              </View>
            ))}

            {todayLog.data ? (
              <>
                <Spacer size="sm" />
                <Button
                  label="Clear today's ratings"
                  variant="ghost"
                  size="compact"
                  onPress={() => void saveRatings({})}
                  accessibilityHint="Removes every rating you have given today"
                  testID="recovery-clear"
                />
              </>
            ) : null}

            {rateDay.pending ? (
              <>
                <Spacer size="sm" />
                <AppText variant="caption" tone="faint" accessibilityLiveRegion="polite">
                  Saving…
                </AppText>
              </>
            ) : null}
            {errors.form ? (
              <>
                <Spacer size="sm" />
                <AppText variant="caption" tone="danger" accessibilityRole="alert">
                  {errors.form}
                </AppText>
              </>
            ) : null}
          </Card>
        </Section>

        <Section title="Log a session">
          <Card>
            <AppText variant="caption" tone="muted">
              Kind
            </AppText>
            <Spacer size="xs" />
            <View style={styles.wrapRow}>
              {MOBILITY_ORDER.map((option) => (
                <View key={option} style={styles.chip}>
                  <Button
                    label={MOBILITY_KIND_LABELS[option]}
                    onPress={() => setKind(option)}
                    variant={kind === option ? 'primary' : 'secondary'}
                    size="compact"
                    selected={kind === option}
                    testID={`recovery-kind-${option}`}
                  />
                </View>
              ))}
            </View>
            <Spacer size="sm" />
            <TextField
              label="Minutes"
              value={minutes}
              onChangeText={setMinutes}
              placeholder="15"
              keyboardType="number-pad"
              error={errors.minutes ?? errors.durationMin}
              testID="recovery-minutes"
            />
            <Spacer size="sm" />
            <Button
              label="Log session"
              onPress={saveMobility}
              loading={logMobility.pending}
              disabled={minutes.trim() === ''}
              fullWidth
              testID="recovery-log-session"
            />
          </Card>
        </Section>

        <Section title={`Last ${WINDOW_DAYS} days`}>
          {report.status === 'loading' || !data ? (
            <StateView state="loading" loadingLabel="Loading recovery" />
          ) : data.ratedDays === 0 ? (
            <StateView
              state="empty"
              compact
              emptyTitle="Nothing rated yet"
              emptyBody="Rate a day above and the averages appear here."
            />
          ) : (
            <Card>
              <AppText variant="caption" tone="muted">
                {data.ratedDays} of {WINDOW_DAYS} days rated
              </AppText>
              {RECOVERY_RATINGS.map((key) => {
                const entry = data.ratings[key];
                return (
                  <View key={key} style={styles.reportRow}>
                    <AppText variant="body" style={styles.grow}>
                      {RATING_LABELS[key]}
                    </AppText>
                    <AppText variant="body" weight="600">
                      {entry.current === null ? '—' : entry.current.toFixed(1)}
                    </AppText>
                  </View>
                );
              })}
              {energyTrend ? (
                <AppText variant="caption" tone="muted">
                  Energy is {energyTrend}.
                </AppText>
              ) : null}
            </Card>
          )}
        </Section>

        <Section title="Mobility">
          {data ? (
            data.mobility.sessions === 0 ? (
              <StateView
                state="empty"
                compact
                emptyTitle="No sessions logged"
                emptyBody={`Nothing recorded in the last ${WINDOW_DAYS} days.`}
              />
            ) : (
              <Card>
                <AppText variant="subheading">
                  {data.mobility.sessions === 1
                    ? '1 session'
                    : `${data.mobility.sessions} sessions`}{' '}
                  · {formatMinutes(data.mobility.totalMinutes)}
                </AppText>
                <Spacer size="xs" />
                <AppText variant="caption" tone="muted">
                  {data.mobility.averageMinutes === null
                    ? 'No average yet.'
                    : `${data.mobility.averageMinutes} minutes on average`}{' '}
                  · {data.mobility.activeDays} of {WINDOW_DAYS} days
                </AppText>
                {data.mobility.byKind.map((entry) => (
                  <View key={entry.kind} style={styles.reportRow}>
                    <AppText variant="caption" tone="muted" style={styles.grow}>
                      {MOBILITY_KIND_LABELS[entry.kind]}
                    </AppText>
                    <AppText variant="caption">
                      {entry.sessions} · {formatMinutes(entry.minutes)}
                    </AppText>
                  </View>
                ))}
              </Card>
            )
          ) : (
            <StateView state="loading" compact loadingLabel="Loading mobility" />
          )}
        </Section>

        {data && data.logs.length > 0 ? (
          <Section title="Recent ratings">
            <Card flush>
              {data.logs.slice(0, 10).map((log, index) => (
                <View key={log.id}>
                  {index > 0 && <View style={styles.divider} />}
                  <View style={styles.reportRow}>
                    <AppText variant="caption" style={styles.grow}>
                      {log.logDate}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {RECOVERY_RATINGS.map((key) => log[key] ?? '—').join(' · ')}
                    </AppText>
                  </View>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {removeMobility.error ? (
          <>
            <Spacer size="md" />
            <StateView state="error" errorMessage={removeMobility.error.message} />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/**
 * A 1-10 scale as discrete buttons rather than a slider.
 *
 * A slider is smaller than the 48pt minimum and its value is invisible to a screen
 * reader, which would make the one number in this screen inaccessible. Buttons are
 * 48pt, individually focusable, and announce their value.
 */
function RatingScale({
  value,
  onChange,
  label,
}: {
  value: number | null;
  onChange: (value: number) => void;
  label: string;
}): React.ReactElement {
  const theme = useTheme();

  return (
    <View style={styles.scale}>
      {Array.from({ length: 10 }, (_, index) => index + 1).map((step) => (
        <View key={step} style={styles.scaleStep}>
          <Button
            label={String(step)}
            accessibilityLabel={`${label}: ${step} out of 10`}
            accessibilityHint="Double tap to record this rating"
            onPress={() => onChange(step)}
            variant={value === step ? 'primary' : 'secondary'}
            size="compact"
            selected={value === step}
            style={{ minWidth: theme.spacing.xxl }}
            testID={`recovery-rating-${step}`}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  ratingBlock: { paddingVertical: 8 },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 3,
  },
  grow: { flex: 1 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { marginRight: 8, marginBottom: 8 },
  scale: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  scaleStep: { marginBottom: 4 },
  divider: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.2,
    marginHorizontal: 16,
  },
});
