import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, Section, StateView } from '@/components/Layout';
import {
  useBodyMetrics,
  useLogSportSession,
  useResumableWorkout,
  useSports,
  useStartWorkout,
  useWorkouts,
} from '@/features/fitness/hooks/useFitness';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDate, todayKey } from '@/utils/dates';
import { formatWeight } from '@/utils/units';
import { useSettings } from '@/stores/settingsStore';
import type { WorkoutActivityType } from '@/types/fitness';

const ACTIVITY_TYPES: { value: WorkoutActivityType; label: string }[] = [
  { value: 'gym', label: 'Gym' },
  { value: 'home', label: 'Home' },
  { value: 'mobility', label: 'Mobility' },
  { value: 'stretching', label: 'Stretching' },
  { value: 'cross_training', label: 'Cross training' },
];

/**
 * Fitness overview.
 *
 * One entry point for every activity type: there is no separate running app and no
 * separate stretching app. That is the "reusable activity architecture" the
 * specification asks for, expressed in navigation as well as in the data model.
 */
export default function FitnessScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { weightUnit } = useSettings();

  const resumable = useResumableWorkout();
  const workouts = useWorkouts(30);
  const body = useBodyMetrics(10);
  const sports = useSports();
  const startWorkout = useStartWorkout();
  const logSession = useLogSportSession();

  const [starting, setStarting] = useState<WorkoutActivityType | null>(null);

  const latestWeight = body.data?.[0]?.weightGrams ?? null;
  const recent = workouts.data ?? [];

  const start = async (label: string, activityType: WorkoutActivityType): Promise<void> => {
    setStarting(activityType);
    const workout = await startWorkout.run(label, activityType);
    setStarting(null);
    if (workout) router.push(`/workout/${workout.id}`);
  };

/* __BODY__ */
return (
    <Screen padded={false}>
      <View style={{ paddingTop: insets.top + theme.spacing.sm, paddingHorizontal: theme.spacing.lg }}>
        <AppText variant="display" accessibilityRole="header">
          Fitness
        </AppText>

        <Spacer size="lg" />

        {resumable.data ? (
          <>
            <Card style={{ borderColor: theme.colors.accent }}>
              <AppText variant="subheading">Workout in progress</AppText>
              <AppText variant="caption" tone="muted">
                {resumable.data.title}
              </AppText>
              <Spacer size="md" />
              <Button
                label="Resume"
                onPress={() => router.push(`/workout/${resumable.data?.id ?? ''}`)}
                fullWidth
                testID="resume-workout"
              />
            </Card>
            <Spacer size="lg" />
          </>
        ) : null}

        <Section title="Start something">
          <View style={styles.wrap}>
            {ACTIVITY_TYPES.map((option) => (
              <Button
                key={option.value}
                label={option.label}
                variant="secondary"
                disabled={startWorkout.pending}
                loading={starting === option.value}
                onPress={() => void start(option.label, option.value)}
                testID={`start-${option.value}`}
              />
            ))}
          </View>
        </Section>

        {latestWeight !== null ? (
          <Section title="Body">
            <Card>
              <AppText variant="title" numeric>
                {formatWeight(latestWeight, weightUnit)}
              </AppText>
              <AppText variant="caption" tone="muted">
                Latest measurement
              </AppText>
            </Card>
          </Section>
        ) : null}

        <Section title="Recent workouts">
          {workouts.status === 'loading' ? (
            <StateView state="loading" loadingLabel="Loading workouts" compact />
          ) : recent.length === 0 ? (
            <Card>
              <AppText variant="callout" tone="muted">
                No workouts logged yet.
              </AppText>
            </Card>
          ) : (
            <View style={{ gap: theme.spacing.sm }}>
              {recent.slice(0, 5).map((workout) => (
                <Pressable
                  key={workout.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${workout.title}, ${workout.status}`}
                  accessibilityHint="Double tap to open this workout."
                  onPress={() => router.push(`/workout/${workout.id}`)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.border,
                      borderRadius: theme.radii.lg,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <AppText variant="subheading">{workout.title}</AppText>
                    <AppText variant="caption" tone="muted">
                      {workout.status === 'in_progress'
                        ? 'In progress'
                        : formatDate(todayKey(new Date(workout.startedAt)))}
                    </AppText>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </Section>

        <Section title="Quick log a sport">
          <View style={styles.wrap}>
            {(sports.data ?? []).slice(0, 8).map((sport) => (
              <Button
                key={sport.id}
                label={sport.name}
                size="compact"
                variant="ghost"
                disabled={logSession.pending}
                onPress={() => void logSession.run({ sportId: sport.id, metrics: {} })}
                accessibilityHint={`Record a quick ${sport.name} session`}
              />
            ))}
          </View>
        </Section>
      </View>
    </Screen>
  );
}

const styles = {
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } as const,
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
  } as const,
};
