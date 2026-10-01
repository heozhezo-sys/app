/**
 * Fitness feature hooks.
 *
 * Screens use these and nothing below.
 */

import { useCallback } from 'react';

import { CHANNELS } from '@/database/database';
import { useAction, useAsyncResource } from '@/hooks/useAsyncResource';
import * as service from '@/services/fitnessService';
import type {
  BodyMetric,
  BodyMetricInput,
  CustomExerciseInput,
  Exercise,
  MuscleGroup,
  SetInput,
  Sport,
  SportSessionInput,
  SportSessionWithSport,
  Workout,
  WorkoutActivityType,
  WorkoutSetWithExercise,
  WorkoutStatus,
} from '@/types/fitness';

export interface WorkoutDetailData {
  workout: Workout;
  sets: WorkoutSetWithExercise[];
}

export function useWorkouts(sinceDays?: number) {
  const load = useCallback(() => service.listWorkouts({ sinceDays }), [sinceDays]);
  return useAsyncResource<Workout[]>(load, CHANNELS.workouts, { deps: [sinceDays] });
}

/** The workout left in progress, so an interrupted session can be resumed. */
export function useResumableWorkout() {
  const load = useCallback(() => service.findResumableWorkout(), []);
  return useAsyncResource<Workout | null>(load, CHANNELS.workouts);
}

export function useWorkoutDetail(workoutId: string) {
  const load = useCallback(async (): Promise<WorkoutDetailData | null> => {
    if (!workoutId) return null;
    const workout = await service.getWorkout(workoutId);
    if (!workout) return null;
    return { workout, sets: await service.listSets(workoutId) };
  }, [workoutId]);

  return useAsyncResource(load, CHANNELS.workouts, { enabled: workoutId !== '' });
}

export function useExercises(muscleGroup?: MuscleGroup) {
  const load = useCallback(() => service.listExercises(muscleGroup), [muscleGroup]);
  return useAsyncResource<Exercise[]>(load, CHANNELS.workouts, { deps: [muscleGroup] });
}

export function useStartWorkout() {
  return useAction((title: string, activityType: WorkoutActivityType) =>
    service.startWorkout({ title, activityType }),
  );
}

export function useLogSet() {
  return useAction((workoutId: string, input: SetInput) => service.logSet(workoutId, input));
}

export function useCompleteWorkout() {
  return useAction((id: string) => service.completeWorkout(id));
}

export function useAbandonWorkout() {
  return useAction((id: string) => service.abandonWorkout(id));
}

export function useDeleteSet() {
  return useAction((id: string) => service.deleteSet(id));
}

export function useBodyMetrics(limit?: number) {
  const load = useCallback(() => service.listBodyMetrics(limit), [limit]);
  return useAsyncResource<BodyMetric[]>(load, CHANNELS.bodyMetrics, { deps: [limit] });
}

export function useRecordBodyMetric() {
  return useAction((input: BodyMetricInput) => service.recordBodyMetric(input));
}

export function useSports(category?: Sport['category']) {
  const load = useCallback(() => service.listSports(category), [category]);
  return useAsyncResource<Sport[]>(load, CHANNELS.sports, { deps: [category] });
}

export function useSportSessions(sportId?: string, sinceDays?: number) {
  const load = useCallback(
    () => service.listSportSessions({ sportId, sinceDays }),
    [sportId, sinceDays],
  );
  return useAsyncResource<SportSessionWithSport[]>(load, CHANNELS.sports, {
    deps: [sportId, sinceDays],
  });
}

export function useLogSportSession() {
  return useAction((input: SportSessionInput) => service.logSportSession(input));
}

export function useCreateCustomExercise() {
  return useAction((input: CustomExerciseInput) => service.createCustomExercise(input));
}

export function usePersonalRecords(exerciseId: string) {
  const load = useCallback(async () => {
    if (!exerciseId) return null;
    return service.personalRecordsForExercise(exerciseId);
  }, [exerciseId]);

  return useAsyncResource(load, CHANNELS.workouts, { enabled: exerciseId !== '' });
}

export type { WorkoutStatus };
