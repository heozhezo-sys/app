import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, Section, StateView } from '@/components/Layout';
import { TextField } from '@/components/TextField';
import { SetRow } from '@/features/fitness/components/SetRow';
import {
  useAbandonWorkout,
  useCompleteWorkout,
  useExercises,
  useLogSet,
  useWorkoutDetail,
} from '@/features/fitness/hooks/useFitness';
import { useSettings } from '@/stores/settingsStore';
import { parseWeightToGrams } from '@/utils/units';
import type { WorkoutSetWithExercise } from '@/types/fitness';

/**
 * Live workout logging.
 *
 * Weight is entered in the user's preferred unit and stored as exact integer grams, so
 * a 2.5 lb plate stays 1134 g instead of drifting to 1133.98.
 */
export default function WorkoutScreen(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const workoutId = typeof params.id === 'string' ? params.id : '';
  const { weightUnit } = useSettings();

  const detail = useWorkoutDetail(workoutId);
  const exercises = useExercises();
  const logSet = useLogSet();
  const complete = useCompleteWorkout();
  const abandon = useAbandonWorkout();

  const [exerciseId, setExerciseId] = useState<string>('');
  const [reps, setReps] = useState('');
  const [weight, setWeight] = useState('');
  const [minutes, setMinutes] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const workout = detail.data?.workout ?? null;
  const sets = detail.data?.sets ?? [];

  const byExercise = new Map<string, WorkoutSetWithExercise[]>();
  for (const set of sets) {
    const list = byExercise.get(set.exerciseId) ?? [];
    list.push(set);
    byExercise.set(set.exerciseId, list);
  }

  const selectedExercise = exerciseId || exercises.data?.[0]?.id || '';

  const submit = async (): Promise<void> => {
    const nextErrors: Record<string, string | undefined> = {};
    if (!selectedExercise) nextErrors.exercise = 'Choose an exercise';
    if (weight.trim() !== '' && parseWeightToGrams(weight, weightUnit) === null) {
      nextErrors.weight = 'Whole number';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const logged = await logSet.run(workoutId, {
      exerciseId: selectedExercise,
      reps: reps.trim() === '' ? null : Number(reps.trim()),
      weightGrams: weight.trim() === '' ? null : parseWeightToGrams(weight, weightUnit),
      durationSec: minutes.trim() === '' ? null : Number(minutes.trim()) * 60,
    });

    if (logged) {
      setReps('');
      setMinutes('');
    }
  };

/* __BODY__ */
if (detail.status === 'loading') {
    return (
      <Screen>
        <StateView state="loading" loadingLabel="Loading workout" />
      </Screen>
    );
  }

  if (detail.status === 'error' || !workout) {
    return (
      <Screen>
        <StateView
          state="error"
          title="Workout not available"
          errorMessage={detail.error?.message ?? 'This workout may have been deleted.'}
          onRetry={() => void detail.refresh()}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <AppText variant="title" accessibilityRole="header">
        {workout.title}
      </AppText>
      <AppText variant="caption" tone="muted">
        {workout.status === 'in_progress' ? 'In progress' : workout.status}
      </AppText>

      <Spacer size="lg" />

      <Card>
        <AppText variant="caption" tone="muted" accessibilityRole="header">
          LOG A SET
        </AppText>
        <Spacer size="sm" />

        <ScrollView style={styles.exerciseList} nestedScrollEnabled>
          <View style={styles.wrap}>
            {(exercises.data ?? []).map((exercise) => (
              <Button
                key={exercise.id}
                label={exercise.name}
                size="compact"
                variant={selectedExercise === exercise.id ? 'primary' : 'secondary'}
                onPress={() => setExerciseId(exercise.id)}
                accessibilityHint={
                  selectedExercise === exercise.id ? 'Selected exercise.' : `Choose ${exercise.name}.`
                }
              />
            ))}
          </View>
        </ScrollView>

        {errors.exercise ? (
          <>
            <Spacer size="xs" />
            <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
              {errors.exercise}
            </AppText>
          </>
        ) : null}

        <Spacer size="md" />
        <View style={styles.wrap}>
          <View style={styles.grow}>
            <TextField
              label="Reps"
              value={reps}
              onChangeText={setReps}
              keyboardType="number-pad"
              placeholder="8"
              testID="set-reps"
            />
          </View>
          <View style={styles.grow}>
            <TextField
              label={`Weight (${weightUnit})`}
              value={weight}
              onChangeText={setWeight}
              error={errors.weight}
              keyboardType="decimal-pad"
              placeholder="60"
              testID="set-weight"
            />
          </View>
          <View style={styles.grow}>
            <TextField
              label="Minutes"
              value={minutes}
              onChangeText={setMinutes}
              keyboardType="number-pad"
              placeholder="0"
              testID="set-minutes"
            />
          </View>
        </View>

        <Spacer size="md" />
        <Button
          label="Log set"
          onPress={() => void submit()}
          loading={logSet.pending}
          fullWidth
          testID="set-submit"
        />

        {logSet.error ? (
          <>
            <Spacer size="sm" />
            <AppText variant="caption" tone="danger" accessibilityLiveRegion="assertive">
              {logSet.error.message}
            </AppText>
          </>
        ) : null}
      </Card>

      <Spacer size="lg" />

      <Section title={`Sets (${sets.length})`}>
        {sets.length === 0 ? (
          <AppText variant="callout" tone="muted">
            No sets yet. Log your first one above.
          </AppText>
        ) : (
          <Card flush>
            {[...byExercise.entries()].map(([id, exerciseSets]) => (
              <View key={id}>
                {exerciseSets.map((set, index) => (
                  <SetRow
                    key={set.id}
                    set={set}
                    showExerciseName={index === 0}
                    weightUnit={weightUnit}
                  />
                ))}
              </View>
            ))}
          </Card>
        )}
      </Section>

      <Spacer size="lg" />

      {workout.status === 'in_progress' ? (
        <>
          <Button
            label="Finish workout"
            onPress={async () => {
              const done = await complete.run(workoutId);
              if (done) router.back();
            }}
            loading={complete.pending}
            fullWidth
            testID="workout-complete"
          />
          <Spacer size="sm" />
          <Button
            label="Discard workout"
            variant="ghost"
            onPress={async () => {
              const done = await abandon.run(workoutId);
              if (done) router.back();
            }}
            loading={abandon.pending}
            fullWidth
          />
        </>
      ) : (
        <Button label="Back to fitness" onPress={() => router.back()} variant="secondary" fullWidth />
      )}
    </Screen>
  );
}

const styles = {
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } as const,
  grow: { flexGrow: 1, flexBasis: 96 } as const,
  exerciseList: { maxHeight: 160 } as const,
};
