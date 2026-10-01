/**
 * Recovery use cases: daily ratings and mobility sessions.
 *
 * Validation lives here, at the service boundary, so every caller — screen, quick-add
 * button or a future import — enforces the same rules.
 *
 * **No medical interpretation.** `FEATURES/RECOVERY.md` requires simple 1-10 personal
 * ratings that are never presented as measurements. Nothing in this file compares a value
 * against a threshold, labels a day good or bad, or recommends anything. It records,
 * averages and describes.
 */

import * as repository from '@/repositories/recoveryRepository';
import type { MobilitySession, RecoveryLog } from '@/repositories/recoveryRepository';
import { ValidationError } from '@/services/errors';
import type { FieldErrors } from '@/utils/validation';
import {
  RECOVERY_RATINGS,
  RATING_MAX,
  RATING_MIN,
  isValidRating,
  ratingAverage,
  ratingSpread,
  trendBetween,
  type RecoveryRating,
  type RecoveryRatings,
} from '@/health/recoveryMath';
import {
  MOBILITY_KINDS,
  formatMinutes,
  recentDateKeys,
  summariseMobility,
  validateSessionMinutes,
  type MobilityKind,
  type MobilitySummary,
} from '@/health/mobilityMath';
import { addDays, todayKey, type DateKey } from '@/utils/dates';
import { NOTE_MAX } from '@/utils/validation';

/** Injectable clock, matching the other health services. */
export type Clock = () => number;

let clock: Clock = () => Date.now();

export function setClock(next: Clock): void {
  clock = next;
}

export function resetClock(): void {
  clock = () => Date.now();
}

function today(): DateKey {
  return todayKey(new Date(clock()));
}

/* ------------------------------------------------------------- daily ratings */

/**
 * Records or updates a day's ratings.
 *
 * Omitted ratings are cleared, not preserved: this writes the day as described. A user
 * who only rates their mood is not asking to keep yesterday's energy figure attached to
 * today. (ADR-0016: omitted input is not invalid input, it simply is not recorded.)
 */
export async function rateDay(input: {
  logDate?: DateKey;
  energy?: number | null;
  soreness?: number | null;
  recovery?: number | null;
  mood?: number | null;
  notes?: string | null;
}): Promise<RecoveryLog> {
  const fields: FieldErrors = {};

  for (const rating of RECOVERY_RATINGS) {
    const value = input[rating];
    if (value === undefined || value === null) continue;
    if (!isValidRating(value)) {
      fields[rating] = `Rate from ${RATING_MIN} to ${RATING_MAX}.`;
    }
  }

  const notes = input.notes?.trim();
  if (notes !== undefined && notes !== null && notes.length > NOTE_MAX) {
    fields.notes = `Keep it under ${NOTE_MAX.toLocaleString()} characters.`;
  }

  if (Object.keys(fields).length > 0) throw new ValidationError(fields);

  const ratings: RecoveryRatings = {};
  for (const rating of RECOVERY_RATINGS) {
    ratings[rating] = input[rating] ?? null;
  }

  return repository.upsertRecoveryLog({
    logDate: input.logDate ?? today(),
    ratings,
    notes: notes === undefined || notes === '' ? null : notes,
    loggedAt: clock(),
  });
}

/** Sets exactly one rating on a day, leaving the others as they are. */
export async function rateOne(
  rating: RecoveryRating,
  value: number,
  logDate?: DateKey,
): Promise<RecoveryLog> {
  if (!isValidRating(value)) {
    throw new ValidationError({ [rating]: `Rate from ${RATING_MIN} to ${RATING_MAX}.` });
  }
  const date = logDate ?? today();
  const existing = await repository.getRecoveryLog(date);
  const patch: Parameters<typeof rateDay>[0] = { logDate: date };
  for (const name of RECOVERY_RATINGS) {
    patch[name] = name === rating ? value : (existing?.[name] ?? null);
  }
  if (existing?.notes !== null && existing?.notes !== undefined) patch.notes = existing.notes;
  return rateDay(patch);
}

export async function recoveryForDay(logDate?: DateKey): Promise<RecoveryLog | null> {
  return repository.getRecoveryLog(logDate ?? today());
}

export async function removeRecoveryDay(id: string): Promise<void> {
  return repository.softDeleteRecoveryLog(id);
}

export interface RecoveryTrend {
  rating: RecoveryRating;
  /** Mean over the recent window. */
  current: number | null;
  /** Mean over the window immediately before it. */
  previous: number | null;
  trend: ReturnType<typeof trendBetween>;
}

export interface RecoveryReport {
  /** Inclusive range covered, newest first. */
  dates: DateKey[];
  logs: RecoveryLog[];
  /** Days out of `dates.length` that carry at least one rating. */
  ratedDays: number;
  /** Per-rating average, trend and spread. Absent ratings report `null`. */
  ratings: Record<RecoveryRating, RecoveryTrend & { spread: ReturnType<typeof ratingSpread> }>;
  mobility: MobilitySummary;
}

/**
 * A recovery report over the `days` days ending on `endDate`.
 *
 * Every figure is derived on read from stored rows, so deleting a night or re-rating a
 * day cannot leave a stale average behind.
 */
export async function recoveryReport(endDate: DateKey, days = 14): Promise<RecoveryReport> {
  const span = Math.max(1, Math.trunc(days));
  const dates = recentDateKeys(endDate, span);
  const from = dates[dates.length - 1] ?? endDate;

  const logs = await repository.listRecoveryLogs(from, endDate);

  // Half the window, rounded up, so odd windows still split into two comparable halves.
  const half = Math.ceil(span / 2);
  const currentKeys = new Set(dates.slice(0, half));
  const previousKeys = new Set(dates.slice(half));

  const ratings = {} as RecoveryReport['ratings'];
  for (const rating of RECOVERY_RATINGS) {
    const current = ratingAverage(
      logs.filter((log) => currentKeys.has(log.logDate)),
      rating,
    );
    const previous = ratingAverage(
      logs.filter((log) => previousKeys.has(log.logDate)),
      rating,
    );
    ratings[rating] = {
      rating,
      current,
      previous,
      trend: trendBetween(current, previous),
      spread: ratingSpread(logs.map((log) => log[rating])),
    };
  }

  const sessions = await repository.listMobilitySessions(from, endDate);

  return {
    dates,
    logs,
    ratedDays: await repository.ratedDayCount(from, endDate),
    ratings,
    mobility: summariseMobility(
      sessions.map((session) => ({
        logDate: session.logDate,
        kind: session.kind,
        durationMin: session.durationMin,
      })),
      span,
    ),
  };
}

/** The `from`/`to` bounds of the `days` days ending on `endDate`. */
export function reportBounds(endDate: DateKey, days: number): { from: DateKey; to: DateKey } {
  const span = Math.max(1, Math.trunc(days));
  return { from: addDays(endDate, -(span - 1)), to: endDate };
}

/* ------------------------------------------------------- mobility sessions */

/** Records a stretching, yoga or mobility session. */
export async function logMobility(input: {
  logDate?: DateKey;
  kind: MobilityKind;
  title?: string | null;
  durationMin: number;
  intensity?: number | null;
  notes?: string | null;
}): Promise<MobilitySession> {
  const fields: FieldErrors = {};

  if (!MOBILITY_KINDS.includes(input.kind)) {
    fields.kind = 'Choose a session type.';
  }

  const minutes = Math.trunc(input.durationMin);
  const durationError = validateSessionMinutes(minutes);
  if (durationError) fields.durationMin = durationError;

  if (
    input.intensity !== undefined &&
    input.intensity !== null &&
    (!Number.isInteger(input.intensity) || input.intensity < RATING_MIN || input.intensity > RATING_MAX)
  ) {
    fields.intensity = `Rate from ${RATING_MIN} to ${RATING_MAX}.`;
  }

  const title = input.title?.trim();
  if (title !== undefined && title !== null && title.length > 120) {
    fields.title = 'Keep the title under 120 characters.';
  }

  const notes = input.notes?.trim();
  if (notes !== undefined && notes !== null && notes.length > NOTE_MAX) {
    fields.notes = `Keep it under ${NOTE_MAX.toLocaleString()} characters.`;
  }

  if (Object.keys(fields).length > 0) throw new ValidationError(fields);

  return repository.insertMobilitySession({
    logDate: input.logDate ?? today(),
    kind: input.kind,
    title: title === undefined || title === '' ? null : title,
    durationMin: minutes,
    intensity: input.intensity ?? null,
    notes: notes === undefined || notes === '' ? null : notes,
    performedAt: clock(),
  });
}

export async function mobilitySessions(
  endDate: DateKey,
  days = 14,
): Promise<MobilitySession[]> {
  const { from, to } = reportBounds(endDate, days);
  return repository.listMobilitySessions(from, to);
}

export async function removeMobility(id: string): Promise<void> {
  return repository.softDeleteMobilitySession(id);
}

export { formatMinutes, summariseMobility, RECOVERY_RATINGS, MOBILITY_KINDS };
export type { RecoveryRating, RecoveryRatings, MobilityKind, MobilitySummary };
