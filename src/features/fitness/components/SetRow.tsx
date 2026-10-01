import React from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme/ThemeProvider';
import { MIN_TOUCH_TARGET } from '@/theme/metrics';
import { formatSetDuration, formatWeight, scaledToRpe } from '@/utils/units';
import type { WeightUnit } from '@/types/settings';
import type { WorkoutSetWithExercise } from '@/types/fitness';

export interface SetRowProps {
  set: WorkoutSetWithExercise;
  weightUnit: WeightUnit;
  /** Only the first row of a group carries the exercise heading. */
  showExerciseName?: boolean;
}

/**
 * One logged set, read-only.
 *
 * Accessibility: the row is a single text node describing the whole set, so a screen
 * reader reads "Squat, set 1, 60 kg, 8 reps, RPE 8" in one pass rather than as
 * fragments. A bodyweight set is stated in words, never implied by an absent number.
 */
export function SetRow({ set, weightUnit, showExerciseName = true }: SetRowProps): React.ReactElement {
  const theme = useTheme();

  const parts: string[] = [`Set ${set.setNumber}`];
  if (set.weightGrams !== null) {
    parts.push(set.weightGrams === 0 ? 'Bodyweight' : formatWeight(set.weightGrams, weightUnit));
  }
  if (set.reps !== null) parts.push(`${set.reps} reps`);
  if (set.durationSec !== null) parts.push(formatSetDuration(set.durationSec));
  if (set.rpeScaled !== null) parts.push(`RPE ${scaledToRpe(set.rpeScaled)}`);
  if (set.setType !== 'working') parts.push(set.setType);

  return (
    <View style={[styles.row, { borderBottomColor: theme.colors.border }]}>
      {showExerciseName ? (
        <AppText variant="callout" weight="600">
          {set.exerciseName}
        </AppText>
      ) : null}
      <AppText
        variant="callout"
        tone="muted"
        numeric
        accessibilityLabel={`${set.exerciseName}, ${parts.join(', ')}`}
      >
        {parts.join(' · ')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 2,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: MIN_TOUCH_TARGET,
  },
});
