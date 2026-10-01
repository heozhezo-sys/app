/**
 * Health use cases: hydration, nutrition and sleep.
 *
 * Validation lives here, at the service boundary, so it applies to every caller rather
 * than only to screens. The clock is injectable for the same reason as the focus service:
 * date-boundary behaviour ("what counts as today") is otherwise untestable.
 *
 * **No medical claims.** `FEATURES/HEALTH.md` requires that this feature avoid diagnosis
 * or advice. Nothing here interprets a value, flags one as dangerous, or recommends
 * anything — the app records and totals, and says nothing about whether a number is good.
 */

import * as repository from '@/repositories/healthRepository';
import type { Food, NutritionEntry, SleepLog, WaterLog } from '@/repositories/healthRepository';
import { ValidationError } from '@/services/errors';
import type { FieldErrors } from '@/utils/validation';
import { DEFAULT_DAILY_TARGET_ML, MAX_ENTRY_ML, parseVolume } from '@/health/units';
import {
  formatClockTime,
  resolveSleepWindow,
  sleepConsistency,
  summariseSleep,
  type SleepSummary,
} from '@/health/sleepMath';
import {
  MEALS,
  fromServingsScale,
  gramsToTenths,
  scaleNutrition,
  toServingsScale,
  totalNutrition,
  type Meal,
  type NutritionSnapshot,
} from '@/health/nutritionMath';
import { addDays, todayKey, type DateKey } from '@/utils/dates';

/** Injectable clock. Production uses `() => Date.now()`. */
export type Clock = () => number;

let clock: Clock = () => Date.now();

export function setClock(next: Clock): void {
  clock = next;
}

export function resetClock(): void {
  clock = () => Date.now();
}

function now(): number {
  return clock();
}

function today(): DateKey {
  return todayKey(new Date(now()));
}

/* --------------------------------------------------------------- hydration */

/**
 * Adds an intake in millilitres.
 *
 * `logDate` defaults to today but is a parameter because back-dating a drink is a normal
 * thing to want, and because "which day is this" should not be decided implicitly far away
 * from the tap.
 */
export async function addWater(input: {
  amountMl: number;
  logDate?: DateKey;
  loggedAt?: number;
}): Promise<WaterLog> {
  const amount = Math.trunc(input.amountMl);
  const fields: FieldErrors = {};

  if (!Number.isFinite(amount) || amount <= 0) {
    fields.amountMl = 'Enter an amount greater than zero.';
  } else if (amount > MAX_ENTRY_ML) {
    fields.amountMl = `That is more than the ${MAX_ENTRY_ML} ml maximum for one entry.`;
  }
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);

  return repository.insertWaterLog({
    logDate: input.logDate ?? today(),
    amountMl: amount,
    loggedAt: input.loggedAt ?? now(),
  });
}

/**
 * Adds from text the user typed, in any supported unit.
 *
 * Accepts `"250ml"`, `"1.5 l"`, `"16 oz"`. Returns `null` for input it cannot parse, so
 * the caller shows a field error instead of logging a wrong amount.
 */
export async function addWaterText(
  input: string,
  options: { logDate?: DateKey } = {},
): Promise<WaterLog | null> {
  const parsed = parseVolume(input);
  if (!parsed) return null;
  return addWater({
    amountMl: parsed.ml,
    ...(options.logDate ? { logDate: options.logDate } : {}),
  });
}

export async function removeWater(id: string): Promise<void> {
  return repository.softDeleteWaterLog(id);
}

export async function waterLogs(date: DateKey): Promise<WaterLog[]> {
  return repository.listWaterLogs(date);
}

export interface HydrationDay {
  date: DateKey;
  totalMl: number;
  targetMl: number;
  /** Integer 0..100. Capped: over-drinking is deliberately not a state. */
  percent: number;
}

export async function hydrationForDay(
  date: DateKey,
  targetMl = DEFAULT_DAILY_TARGET_ML,
): Promise<HydrationDay> {
  const totalMl = await repository.waterTotal(date);
  const target = targetMl > 0 ? targetMl : DEFAULT_DAILY_TARGET_ML;
  return {
    date,
    totalMl,
    targetMl: target,
    // Capped deliberately. Showing 140% invites the thought that more is better, which is
    // exactly the kind of health claim this feature must not make.
    percent: Math.min(100, Math.round((totalMl / target) * 100)),
  };
}
/* ------------------------------------------------------------------ foods */

export async function createFood(input: {
  name: string;
  servingGrams: number;
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
  fiberGrams: number;
}): Promise<Food> {
  const fields: FieldErrors = {};

  const name = input.name.trim();
  if (name === '') fields.name = 'Give the food a name.';
  else if (name.length > 120) fields.name = 'That name is too long.';

  const serving = Math.trunc(input.servingGrams);
  if (!Number.isFinite(serving) || serving <= 0) {
    fields.servingGrams = 'Enter a serving size in grams.';
  } else if (serving > 5000) {
    fields.servingGrams = 'That serving size is unusually large.';
  }

  if (!Number.isFinite(input.calories) || input.calories < 0) {
    fields.calories = 'Enter calories as zero or more.';
  }

  // Grams are floats at the input boundary and integers everywhere else; converting here
  // keeps the rounding decision in exactly one place.
  const macroFields = [
    ['proteinGrams', input.proteinGrams],
    ['carbsGrams', input.carbsGrams],
    ['fatGrams', input.fatGrams],
    ['fiberGrams', input.fiberGrams],
  ] as const;

  for (const [field, value] of macroFields) {
    if (!Number.isFinite(value) || value < 0) {
      fields[field] = 'Enter grams as zero or more.';
    } else if (value > 10_000) {
      fields[field] = 'That amount is unusually large.';
    }
  }

  if (Object.keys(fields).length > 0) throw new ValidationError(fields);

  return repository.insertFood({
    name,
    servingGrams: serving,
    calories: Math.round(input.calories),
    proteinG: gramsToTenths(input.proteinGrams),
    carbsG: gramsToTenths(input.carbsGrams),
    fatG: gramsToTenths(input.fatGrams),
    fiberG: gramsToTenths(input.fiberGrams),
  });
}

export async function listFoods(limit?: number): Promise<Food[]> {
  return repository.listFoods(limit);
}

/**
 * Updates a food definition.
 *
 * Does not touch existing nutrition entries: they snapshot their values, so a correction
 * applies from now on and leaves the past alone.
 */
export async function editFood(
  id: string,
  patch: Parameters<typeof repository.updateFood>[1],
): Promise<Food | null> {
  return repository.updateFood(id, patch);
}

/* --------------------------------------------------------------- nutrition */

/**
 * Logs an intake from a saved food.
 *
 * The scaled snapshot is computed here and written to the entry, so the entry keeps
 * reporting what was eaten even if the food is later edited or deleted.
 */
export async function logFood(input: {
  foodId: string;
  servings: number;
  meal: Meal;
  eatenAt?: number;
}): Promise<NutritionEntry> {
  const food = await repository.getFood(input.foodId);
  if (!food) throw new ValidationError({ foodId: 'That food no longer exists.' });

  if (!MEALS.includes(input.meal)) {
    throw new ValidationError({ meal: 'Choose breakfast, lunch, dinner or snack.' });
  }
  if (!Number.isFinite(input.servings) || input.servings <= 0) {
    throw new ValidationError({ servings: 'Enter at least one part of a serving.' });
  }

  const servings = toServingsScale(input.servings);
  if (servings > 100 * 20) {
    throw new ValidationError({ servings: 'That is more than 20 servings.' });
  }

  return repository.insertNutritionEntry({
    foodId: food.id,
    name: food.name,
    meal: input.meal,
    eatenAt: input.eatenAt ?? now(),
    servingsX100: servings,
    nutrition: scaleNutrition(
      {
        servingGrams: food.servingGrams,
        calories: food.calories,
        proteinG: food.proteinG,
        carbsG: food.carbsG,
        fatG: food.fatG,
        fiberG: food.fiberG,
      },
      servings,
    ),
  });
}

/** Logs a one-off intake with no saved food behind it. */
export async function logAdHoc(input: {
  name: string;
  servings?: number;
  meal: Meal;
  eatenAt?: number;
  nutrition: NutritionSnapshot;
}): Promise<NutritionEntry> {
  const name = input.name.trim();
  const fields: FieldErrors = {};

  if (name === '') fields.name = 'Give it a name.';
  if (!MEALS.includes(input.meal)) fields.meal = 'Choose a meal.';

  for (const value of Object.values(input.nutrition)) {
    // Storage is integer-only; a fractional value here would be silently rounded by SQLite.
    if (!Number.isInteger(value) || value < 0) {
      fields.nutrition = 'Nutrition values must be whole numbers of zero or more.';
      break;
    }
  }
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);

  return repository.insertNutritionEntry({
    foodId: null,
    name,
    meal: input.meal,
    eatenAt: input.eatenAt ?? now(),
    servingsX100: toServingsScale(input.servings ?? 1),
    nutrition: input.nutrition,
  });
}

export async function removeNutritionEntry(id: string): Promise<void> {
  return repository.softDeleteNutritionEntry(id);
}

export interface NutritionDay {
  date: DateKey;
  entries: NutritionEntry[];
  totals: NutritionSnapshot;
  byMeal: Record<Meal, NutritionSnapshot[]>;
}

/**
 * Everything logged on one local calendar day.
 *
 * Day bounds are built from the local date key and widened to the whole day, so an entry
 * at 23:59 groups with the day the user means rather than the UTC one.
 */
export async function nutritionForDay(date: DateKey): Promise<NutritionDay> {
  const [year, month, day] = date.split('-').map(Number);
  const from = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0).getTime();
  const to = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 23, 59, 59, 999).getTime();

  const entries = await repository.listNutritionEntries(from, to);

  // Built by explicit assignment rather than `Object.fromEntries`, which widens the value
  // type to `never[]` and loses the meal keys.
  const byMeal: Record<Meal, NutritionSnapshot[]> = {
    breakfast: [],
    lunch: [],
    dinner: [],
    snack: [],
  };
  for (const entry of entries) byMeal[entry.meal].push(entry.nutrition);

  return {
    date,
    entries,
    totals: totalNutrition(entries.map((entry) => entry.nutrition)),
    byMeal,
  };
}

/* ------------------------------------------------------------------ sleep */

/**
 * Logs a night.
 *
 * `sleepDate` is the date the user woke up on; the bedtime may belong to the previous
 * evening. `resolveSleepWindow` handles that, and the schema's `wake_time >= bedtime`
 * check is only satisfiable because of it.
 */
export async function logSleep(input: {
  sleepDate?: DateKey;
  bedtime: string;
  wakeTime: string;
  quality?: number | null;
  notes?: string | null;
}): Promise<SleepLog> {
  const date = input.sleepDate ?? today();

  const resolved = resolveSleepWindow({
    sleepDate: date,
    bedtime: input.bedtime,
    wakeTime: input.wakeTime,
  });
  if (!resolved.ok) {
    // Keyed by the caller's field names, not the internal ones.
    throw new ValidationError({ [resolved.field]: resolved.message });
  }

  if (
    input.quality !== undefined &&
    input.quality !== null &&
    (!Number.isInteger(input.quality) || input.quality < 1 || input.quality > 10)
  ) {
    throw new ValidationError({ quality: 'Rate sleep quality from 1 to 10.' });
  }

  const notes = input.notes?.trim();

  return repository.insertSleepLog({
    sleepDate: date,
    bedtime: resolved.window.bedtime,
    wakeTime: resolved.window.wakeTime,
    durationMin: resolved.window.durationMin,
    quality: input.quality ?? null,
    notes: notes === undefined || notes === '' ? null : notes,
  });
}

export async function removeSleep(id: string): Promise<void> {
  return repository.softDeleteSleepLog(id);
}

export interface SleepReport extends SleepSummary {
  logs: SleepLog[];
  /** Night-to-night spread in minutes, or null when there are too few nights. */
  consistencyMinutes: number | null;
}

/**
 * Sleep over the `days` days ending on `endDate`.
 *
 * Both the average and the consistency figure are derived from the stored logs on every
 * read, so editing or deleting a night cannot leave a stale statistic behind.
 */
export async function sleepReport(endDate: DateKey, days = 14): Promise<SleepReport> {
  const from = addDays(endDate, -(Math.max(1, days) - 1));
  const logs = await repository.listSleepLogs(from, endDate);
  const durations = logs.map((log) => log.durationMin);

  return {
    ...summariseSleep(durations),
    logs,
    consistencyMinutes: sleepConsistency(durations),
  };
}

/** `23:00 to 07:00`, for display beside a stored log. */
export function describeSleepWindow(log: SleepLog): string {
  return `${formatClockTime(log.bedtime)} to ${formatClockTime(log.wakeTime)}`;
}

export { fromServingsScale, DEFAULT_DAILY_TARGET_ML };
