/**
 * Health feature hooks.
 *
 * Screens use these rather than the service, so the use-case layer stays the single place
 * that knows how a day's data is defined. Dates are `DateKey` strings in local time
 * throughout, which is the same key the schema stores.
 */

import { useCallback } from 'react';

import { CHANNELS } from '@/database/database';
import { useAction, useAsyncResource } from '@/hooks/useAsyncResource';
import * as service from '@/services/healthService';
import { DEFAULT_DAILY_TARGET_ML } from '@/health/units';
import { todayKey, type DateKey } from '@/utils/dates';

/** Hydration for one day: total, target and the capped percentage. */
export function useHydration(date: DateKey) {
  return useAsyncResource(
    () => service.hydrationForDay(date, DEFAULT_DAILY_TARGET_ML),
    CHANNELS.health,
    { deps: [date] },
  );
}

export function useWaterLogs(date: DateKey) {
  return useAsyncResource(() => service.waterLogs(date), CHANNELS.health, { deps: [date] });
}

export function useAddWater() {
  return useAction((amountMl: number) => service.addWater({ amountMl }));
}

/** Quick-add from typed text. Returns `null` when the text cannot be parsed. */
export function useAddWaterText() {
  return useAction((text: string) => service.addWaterText(text));
}

export function useRemoveWater() {
  return useAction((id: string) => service.removeWater(id));
}

export function useNutritionDay(date: DateKey) {
  return useAsyncResource(() => service.nutritionForDay(date), CHANNELS.nutrition, {
    deps: [date],
  });
}

export function useFoods() {
  return useAsyncResource(() => service.listFoods(), CHANNELS.nutrition);
}

export function useCreateFood() {
  return useAction((input: Parameters<typeof service.createFood>[0]) => service.createFood(input));
}

export function useLogFood() {
  return useAction((input: Parameters<typeof service.logFood>[0]) => service.logFood(input));
}

export function useRemoveNutritionEntry() {
  return useAction((id: string) => service.removeNutritionEntry(id));
}

export function useSleepReport(date: DateKey, days = 14) {
  return useAsyncResource(() => service.sleepReport(date, days), CHANNELS.sleep, {
    deps: [date, days],
  });
}

export function useLogSleep() {
  return useAction((input: Parameters<typeof service.logSleep>[0]) => service.logSleep(input));
}

export function useRemoveSleep() {
  return useAction((id: string) => service.removeSleep(id));
}

/** Today, from the device clock. */
export function useToday(): DateKey {
  // `todayKey` is pure, so there is nothing to subscribe to here; a screen that needs to
  // roll over at midnight should remount or re-render, not re-poll this.
  const getToday = useCallback(() => todayKey(new Date()), []);
  return getToday();
}
