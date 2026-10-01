/**
 * Nutrition arithmetic.
 *
 * Every stored value is an integer: macros in tenths of a gram (`_g_x10`), servings in
 * hundredths (`_servings_x100`). No float column exists in this schema, and nothing here
 * produces one — scaling a serving multiplies two integers and rounds once, at the end.
 *
 * **The snapshot rule.** `nutrition_entries` stores its own copy of calories and macros
 * rather than pointing at the food row for its numbers. That is deliberate: editing a food
 * definition tomorrow must not silently rewrite what someone ate last Tuesday. Every
 * function here returns a snapshot, never a live reference to a `foods` row.
 */

/** A food definition: per-serving values, integers as stored. */
export interface FoodNutrition {
  /** Grams in one serving. */
  servingGrams: number;
  calories: number;
  /** Tenths of a gram. */
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}

/** What an entry actually consumed, already scaled. */
export interface NutritionSnapshot {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}

/** Servings are stored ×100 so a quarter serving is exactly representable. */
export const SERVINGS_SCALE = 100;

export function toServingsScale(servings: number): number {
  return Math.round(servings * SERVINGS_SCALE);
}

export function fromServingsScale(servingsX100: number): number {
  return servingsX100 / SERVINGS_SCALE;
}

/**
 * Scales a food definition by a number of servings.
 *
 * Rounds once, after multiplying, so there is no per-step error to accumulate. Rounding a
 * quarter serving of a 15.0 g protein food gives 3.8 g rather than 3.75 g: the stored
 * value is a whole tenth of a gram, so a small loss is unavoidable. It is bounded by half
 * a tenth of a gram per field per entry, which is recorded here rather than glossed over —
 * and it is why `scaleNutrition` makes no claim that n sub-servings re-sum to n.
 */
export function scaleNutrition(food: FoodNutrition, servingsX100: number): NutritionSnapshot {
  const factor = servingsX100 / SERVINGS_SCALE;
  return {
    calories: Math.round(food.calories * factor),
    proteinG: Math.round(food.proteinG * factor),
    carbsG: Math.round(food.carbsG * factor),
    fatG: Math.round(food.fatG * factor),
    fiberG: Math.round(food.fiberG * factor),
  };
}

/** Totals for a day. Fields are added as integers, so the sum is exact. */
export function totalNutrition(entries: NutritionSnapshot[]): NutritionSnapshot {
  return entries.reduce<NutritionSnapshot>(
    (acc, entry) => ({
      calories: acc.calories + entry.calories,
      proteinG: acc.proteinG + entry.proteinG,
      carbsG: acc.carbsG + entry.carbsG,
      fatG: acc.fatG + entry.fatG,
      fiberG: acc.fiberG + entry.fiberG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  );
}

export const EMPTY_TOTALS: NutritionSnapshot = {
  calories: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  fiberG: 0,
};

/**
 * Calories contributed by each macro, using 4/4/9 kcal per gram.
 *
 * Fiber is included at 4 kcal/g because that is how it is counted on nutrition labels in
 * most jurisdictions; excluding it would make the label total disagree with the app's.
 */
export function macroCalories(totals: NutritionSnapshot): number {
  return Math.round(
    (totals.proteinG / 10) * 4 + (totals.carbsG / 10) * 4 + (totals.fatG / 10) * 9,
  );
}

/**
 * Share of calories from each macro, 0..1.
 *
 * Returns zeros when there are no calories rather than dividing by zero: "0% of nothing"
 * is the honest answer for an empty day.
 */
export function macroSplit(
  totals: NutritionSnapshot,
): { protein: number; carbs: number; fat: number } {
  const protein = (totals.proteinG / 10) * 4;
  const carbs = (totals.carbsG / 10) * 4;
  const fat = (totals.fatG / 10) * 9;
  const sum = protein + carbs + fat;

  if (sum === 0) return { protein: 0, carbs: 0, fat: 0 };
  return { protein: protein / sum, carbs: carbs / sum, fat: fat / sum };
}

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEALS: readonly Meal[] = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

/** Grams to tenths, for input. Rounds once, never truncates. */
export function gramsToTenths(grams: number): number {
  if (!Number.isFinite(grams) || grams < 0) return 0;
  return Math.round(grams * 10);
}

export function tenthsToGrams(tenths: number): number {
  return tenths / 10;
}

/** Macro figures for display. */
export function formatGrams(tenths: number): string {
  const grams = tenths / 10;
  // Whole numbers lose the trailing ".0", which reads as false precision otherwise.
  return Number.isInteger(grams) ? `${grams}` : grams.toFixed(1);
}
