/**
 * Focus and review use cases.
 *
 * All time comes from an injectable clock rather than `Date.now()` inside the logic, so
 * the behaviour that matters — resuming after the app was killed, detecting a deadline
 * that passed while closed, rejecting a second concurrent timer — is reproducible in a
 * test instead of only observable by waiting.
 */

import * as repository from '@/repositories/focusRepository';
import type { FocusSession } from '@/repositories/focusRepository';
import {
  validatePreset,
  type FocusKind,
} from '@/focus/presets';
import {
  completionRatio,
  elapsedMinutes,
  isStaleActive,
  readTimer,
  type FocusWindow,
  type TimerSnapshot,
} from '@/focus/timerMath';
import { ValidationError } from '@/services/errors';
import type { FieldErrors } from '@/utils/validation';
import { isoWeekKey, monthKey, todayKey, yearKey, type DateKey } from '@/utils/dates';
import { logger } from '@/utils/logger';

/** Injectable clock. Production uses `() => Date.now()`. */
export type Clock = () => number;

let clock: Clock = () => Date.now();

/** Replaces the clock. Tests use this; production never calls it. */
export function setClock(next: Clock): void {
  clock = next;
}

export function resetClock(): void {
  clock = () => Date.now();
}

export type StartError =
  | { kind: 'already_running'; session: FocusSession }
  | { kind: 'invalid'; field: string; message: string };

export interface StartInput {
  kind?: FocusKind;
  focusMinutes?: number;
  breakMinutes?: number;
  label?: string | null;
  intent?: string | null;
  taskId?: string | null;
  goalId?: string | null;
  /** Start in the past, for tests and for recovering an interrupted session. */
  startedAt?: number;
}

/**
 * Starts a session, or explains why it cannot start.
 *
 * A second timer is refused rather than replacing the first. Two active timers would
 * mean two `ends_at` deadlines and no defensible answer to "which one is running"; the
 * partial UNIQUE index enforces this in the database as well.
 */
export async function startSession(
  input: StartInput = {},
): Promise<{ ok: true; session: FocusSession } | { ok: false; error: StartError }> {
  const existing = await repository.getActiveSession();
  if (existing) return { ok: false, error: { kind: 'already_running', session: existing } };

  const preset = validatePreset({
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.focusMinutes !== undefined ? { focusMinutes: input.focusMinutes } : {}),
    ...(input.breakMinutes !== undefined ? { breakMinutes: input.breakMinutes } : {}),
  });
  if (!preset.ok) {
    return { ok: false, error: { kind: 'invalid', field: preset.field, message: preset.message } };
  }

  const startedAt = input.startedAt ?? clock();
  const endsAt = startedAt + preset.value.focusMinutes * 60_000;

  const session = await repository.insertSession({
    kind: preset.value.kind,
    label: normalise(input.label),
    intent: normalise(input.intent),
    plannedMin: preset.value.focusMinutes,
    breakMin: preset.value.breakMinutes,
    cycleIndex: await nextCycleIndex(),
    startedAt,
    endsAt,
    taskId: input.taskId ?? null,
    goalId: input.goalId ?? null,
  });

  return { ok: true, session };
}

/**
 * Next index in the pomodoro cycle, derived rather than stored.
 *
 * Counted from today's completed sessions, so a number shown to the user cannot drift
 * from the sessions it describes.
 */
async function nextCycleIndex(): Promise<number> {
  const totals = await repository.focusTotals(startOfTodayMs());
  return totals.completed + 1;
}

function startOfTodayMs(): number {
  const key: DateKey = todayKey(new Date(clock()));
  return new Date(`${key}T00:00:00`).getTime();
}

/** A session combined with its live timer reading. */
export interface ActiveSessionView {
  session: FocusSession;
  timer: TimerSnapshot;
}

/**
 * The active session, if any, with a freshly computed timer.
 *
 * Returns `null` when there is no active session. A session whose deadline has passed is
 * still returned with `timer.expired: true`; `recoverStaleSession` decides what to do.
 */
export async function getActiveView(): Promise<ActiveSessionView | null> {
  const session = await repository.getActiveSession();
  if (!session) return null;
  return { session, timer: readTimer(session, clock()) };
}

/**
 * Resolves a session left `active` whose deadline passed while the app was closed.
 *
 * Called on launch. Without this the app would offer to resume a timer for time the user
 * did not have it open, and the session would sit `active` forever, blocking every new
 * timer through the single-active-session rule.
 *
 * Such a session is recorded as completed rather than abandoned: the user did run it, the
 * app simply was not open to see it end. `actual_sec` is capped at the planned length so
 * a session left open for a week does not report a week of focus.
 */
export async function recoverStaleSession(): Promise<FocusSession | null> {
  const session = await repository.getActiveSession();
  if (!session) return null;

  const now = clock();
  if (!isStaleActive(session, now)) return null;

  const plannedSec = session.plannedMin * 60;
  const actualSec = Math.min(
    plannedSec,
    Math.max(0, Math.round((now - session.startedAt) / 1000)),
  );

  const recovered = await repository.resolveSession(session.id, 'completed', {
    completedAt: now,
    actualSec,
  });
  logger.info(`Recovered focus session ${session.id} as completed (${actualSec}s)`);
  return recovered;
}
/**
 * Completes a session early, or on time.
 *
 * `endedAt` defaults to the clock. Actual seconds are measured from `started_at`, not
 * from the remaining time, so an early completion records the real elapsed duration.
 */
export async function completeSession(
  id: string,
  endedAt?: number,
): Promise<FocusSession | null> {
  const session = await repository.getSession(id);
  if (!session || session.status !== 'active') return null;

  const at = endedAt ?? clock();
  const plannedSec = session.plannedMin * 60;
  // Never more than planned: a session resolved after its deadline did not overrun.
  const actualSec = Math.min(plannedSec, Math.max(0, Math.round((at - session.startedAt) / 1000)));

  return repository.resolveSession(id, 'completed', { completedAt: at, actualSec });
}

/**
 * Abandons a session.
 *
 * The elapsed time is still recorded, because "I stopped after eight minutes" is real
 * information and hiding it would make the statistics dishonest.
 */
export async function abandonSession(
  id: string,
  endedAt?: number,
): Promise<FocusSession | null> {
  const session = await repository.getSession(id);
  if (!session || session.status !== 'active') return null;

  const at = endedAt ?? clock();
  const actualSec = Math.max(0, Math.round((at - session.startedAt) / 1000));

  return repository.resolveSession(id, 'abandoned', { completedAt: at, actualSec });
}

/** Abandons a still-running session so a new one can begin. */
export async function abandonActive(): Promise<FocusSession | null> {
  const active = await repository.getActiveSession();
  if (!active) return null;
  return abandonSession(active.id);
}

export async function listSessions(options: { limit?: number; since?: number } = {}) {
  return repository.listSessions(options);
}

/** Totals for today, derived from stored sessions. */
export async function todayTotals(): Promise<{
  completed: number;
  abandoned: number;
  focusMinutes: number;
}> {
  return repository.focusTotals(startOfTodayMs());
}

/** How much of a session was used, 0..1. For display only. */
export function usedRatio(session: FocusSession, endedAt: number): number {
  return completionRatio(session as FocusWindow, endedAt);
}

/** Minutes a session ran for, derived. */
export function usedMinutes(session: FocusSession, endedAt: number): number {
  return elapsedMinutes(session as FocusWindow, endedAt);
}

export { DEFAULT_PRESET, MAX_BREAK_MINUTES, MAX_FOCUS_MINUTES, FOCUS_PRESETS } from '@/focus/presets';
export type { FocusSession, ReviewPeriod } from '@/repositories/focusRepository';
export type { TimerSnapshot };

/* ------------------------------------------------------------------- reviews */

export interface ReviewInput {
  periodType: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** Defaults to the current period, so "save today's review" needs no arguments. */
  date?: DateKey;
  body: string;
  wins?: string | null;
  challenges?: string | null;
  nextActions?: string | null;
  moodScore?: number | null;
}

/**
 * The period key for a review.
 *
 * Weekly uses the ISO week, so a review belongs to the week a reader would recognise
 * rather than to a row offset that shifts when the year does.
 */
export function periodKeyFor(periodType: ReviewInput['periodType'], date: DateKey): string {
  switch (periodType) {
    case 'daily':
      return date;
    case 'weekly':
      return isoWeekKey(date);
    case 'monthly':
      return monthKey(date);
    case 'yearly':
      return yearKey(date);
    default:
      return date;
  }
}

/**
 * Creates or replaces a review.
 *
 * Validation lives here rather than in the UI, per the service-boundary rule: a review is
 * not just "a body of text" — the mood score has a real range and the body has to mean
 * something.
 */
export async function saveReview(input: ReviewInput): Promise<repository.Review> {
  const fields: FieldErrors = {};

  const body = (input.body ?? '').trim();
  if (body === '') {
    fields.body = 'Write something before saving.';
  } else if (body.length > 10_000) {
    fields.body = 'That review is too long.';
  }

  if (input.moodScore !== undefined && input.moodScore !== null) {
    if (!Number.isInteger(input.moodScore) || input.moodScore < 1 || input.moodScore > 10) {
      fields.moodScore = 'Rate your mood from 1 to 10.';
    }
  }

  if (Object.keys(fields).length > 0) throw new ValidationError(fields);

  const date = input.date ?? todayKey(new Date(clock()));
  return repository.upsertReview({
    periodType: input.periodType,
    periodKey: periodKeyFor(input.periodType, date),
    body,
    wins: normalise(input.wins),
    challenges: normalise(input.challenges),
    nextActions: normalise(input.nextActions),
    moodScore: input.moodScore ?? null,
  });
}

export async function getReview(periodType: ReviewInput['periodType'], date?: DateKey) {
  const key = date ?? todayKey(new Date(clock()));
  return repository.getReview(periodType, periodKeyFor(periodType, key));
}

export async function listReviews(limit?: number) {
  return repository.listReviews(limit);
}

export async function removeReview(id: string): Promise<void> {
  return repository.removeReview(id);
}

/** Trims and converts empty strings to `null`, so absent text is stored as absent. */
function normalise(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
