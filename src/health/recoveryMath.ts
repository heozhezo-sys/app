/**
 * Recovery arithmetic.
 *
 * `FEATURES/RECOVERY.md` is explicit that these are **simple 1-10 personal ratings** and
 * must never be presented as medical measurements. So there is deliberately:
 *
 *  - no reference range, no "healthy" threshold, and no score that grades the user;
 *  - no interpretation — nothing here says a day was good or bad;
 *  - no cross-metric formula that invents a single "readiness" number, because
 *    combining energy, soreness and mood into one index is exactly the kind of
 *    pseudo-measurement the specification forbids.
 *
 * Everything here is a description of what the user recorded, never a verdict about it.
 */

/** The four ratings `FEATURES/RECOVERY.md` asks for. */
export const RECOVERY_RATINGS = ['energy', 'soreness', 'recovery', 'mood'] as const;

export type RecoveryRating = (typeof RECOVERY_RATINGS)[number];

export type RecoveryRatings = {
  [K in RecoveryRating]?: number | null | undefined;
};

/** Lowest and highest permitted rating. Enforced here, in the schema, and in the UI. */
export const RATING_MIN = 1;
export const RATING_MAX = 10;

export function isValidRating(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= RATING_MIN && value <= RATING_MAX
  );
}

/**
 * Averages the supplied values, ignoring the absent ones.
 *
 * Returns `null` for an empty list rather than `0`. "No readings" and "an average of
 * zero" are different facts, and collapsing them would invent a 0/10 day out of nothing.
 * The result is rounded to one decimal place for display; nothing accumulates a float
 * total, because a rating average is a presentation number, not stored state.
 */
export function averageRating(values: readonly (number | null | undefined)[]): number | null {
  const present = values.filter(isValidRating);
  if (present.length === 0) return null;
  const total = present.reduce((sum, value) => sum + value, 0);
  return Math.round((total / present.length) * 10) / 10;
}

/** Mean of one named rating across a series, ignoring days where it was not recorded. */
export function ratingAverage(
  ratings: readonly RecoveryRatings[],
  rating: RecoveryRating,
): number | null {
  return averageRating(ratings.map((entry) => entry[rating]));
}

export interface RecoverySpread {
  /** Smallest recorded value, or null when nothing was recorded. */
  min: number | null;
  /** Largest recorded value, or null when nothing was recorded. */
  max: number | null;
  /** `max - min`, or null when fewer than two readings exist. */
  range: number | null;
}

/**
 * How much one rating moved.
 *
 * Deliberately a range and not a standard deviation: with 1-10 integer self-ratings over a
 * fortnight, a spread between the lowest and highest is honest and instantly legible,
 * where a standard deviation would imply a precision the data does not have.
 */
export function ratingSpread(values: readonly (number | null | undefined)[]): RecoverySpread {
  const present = values.filter(isValidRating);
  if (present.length === 0) return { min: null, max: null, range: null };
  const min = Math.min(...present);
  const max = Math.max(...present);
  return { min, max, range: present.length < 2 ? null : max - min };
}

/**
 * The change between two averages, for "up/down on last week".
 *
 * Returns `null` unless both periods have data, so the UI never renders a trend arrow
 * built from a single day on one side.
 */
export function trendBetween(
  current: number | null,
  previous: number | null,
): { delta: number; direction: 'up' | 'down' | 'flat' } | null {
  if (current === null || previous === null) return null;
  const delta = Math.round((current - previous) * 10) / 10;
  if (delta > 0) return { delta, direction: 'up' };
  if (delta < 0) return { delta, direction: 'down' };
  return { delta: 0, direction: 'flat' };
}

/**
 * Word for a rating, for accessibility labels and for anyone who cannot see the dots.
 *
 * The specification forbids conveying state by colour alone, so every rating control
 * pairs its value with one of these.
 */
export function ratingLabel(rating: RecoveryRating, value: number | null | undefined): string {
  const name = RATING_LABELS[rating];
  if (!isValidRating(value)) return `${name} not recorded`;
  return `${name} ${value} out of ${RATING_MAX}`;
}

export const RATING_LABELS: Record<RecoveryRating, string> = {
  energy: 'Energy',
  soreness: 'Soreness',
  recovery: 'Recovery',
  mood: 'Mood',
};

/**
 * Filler text explaining the scale.
 *
 * "Soreness" is the one rating where direction is ambiguous — 1 means fresh, 10 means
 * very sore — so each rating states its own ends rather than sharing one legend that
 * would be wrong for three of the four.
 */
export const RATING_HINTS: Record<RecoveryRating, string> = {
  energy: '1 is depleted, 10 is full of it',
  soreness: '1 is fresh, 10 is very sore',
  recovery: '1 is worn down, 10 is rested',
  mood: '1 is low, 10 is great',
};
