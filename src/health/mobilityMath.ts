/**
 * Mobility and recovery-session arithmetic.
 *
 * `FEATURES/FEATURES_MASTER.md` groups stretching, yoga, mobility and recovery under one
 * activity shape, and `FEATURES/RECOVERY.md` asks for mobility sessions alongside the
 * daily ratings. These are the pure helpers that shape turns them into a report.
 */

import { addDays, type DateKey } from '@/utils/dates';

/** Session kinds, matching the `mobility_sessions.kind` CHECK constraint. */
export const MOBILITY_KINDS = [
  'stretch',
  'mobility',
  'yoga',
  'foam_roll',
  'breathing',
  'other',
] as const;

export type MobilityKind = (typeof MOBILITY_KINDS)[number];

export const MOBILITY_KIND_LABELS: Record<MobilityKind, string> = {
  stretch: 'Stretching',
  mobility: 'Mobility',
  yoga: 'Yoga',
  foam_roll: 'Foam rolling',
  breathing: 'Breathing',
  other: 'Other',
};

/** Longest single session we accept, in minutes. Beyond this it is a typo, not a session. */
export const MAX_SESSION_MIN = 600;

/** Validates a duration, returning the reason it is unacceptable or `null` when fine. */
export function validateSessionMinutes(minutes: number): string | null {
  if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) {
    return 'Enter whole minutes.';
  }
  if (minutes <= 0) return 'Enter a duration greater than zero.';
  if (minutes > MAX_SESSION_MIN) return `That is longer than ${MAX_SESSION_MIN} minutes.`;
  return null;
}

/** `50 min`, or `1h 10m` past an hour. */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export interface MobilitySessionInput {
  logDate: DateKey;
  kind: MobilityKind;
  durationMin: number;
  intensity?: number | null;
}

export interface MobilitySummary {
  /** Number of sessions recorded. */
  sessions: number;
  /** Total minutes across those sessions. */
  totalMinutes: number;
  /** Mean session length, or null when there are no sessions. */
  averageMinutes: number | null;
  /** Sessions per kind, largest first. */
  byKind: { kind: MobilityKind; sessions: number; minutes: number }[];
  /** Days in the range that had at least one session. */
  activeDays: number;
  /** Days covered by the window, as passed in by the caller. */
  daysInRange: number;
}

/**
 * Summarises mobility work over a set of sessions.
 *
 * `rangeDays` is passed in rather than inferred from the sessions, because "3 sessions
 * this fortnight" is a different statement from "3 sessions ever" and only the caller
 * knows which window the user is looking at. Reporting it back lets the UI say "3 sessions
 * over 14 days" without re-deriving the window.
 */
export function summariseMobility(
  sessions: readonly MobilitySessionInput[],
  rangeDays: number,
): MobilitySummary {
  const minutesByKind = new Map<MobilityKind, { sessions: number; minutes: number }>();
  const days = new Set<DateKey>();
  let totalMinutes = 0;

  for (const session of sessions) {
    totalMinutes += session.durationMin;
    days.add(session.logDate);
    const entry = minutesByKind.get(session.kind) ?? { sessions: 0, minutes: 0 };
    entry.sessions += 1;
    entry.minutes += session.durationMin;
    minutesByKind.set(session.kind, entry);
  }

  const byKind = [...minutesByKind.entries()]
    .map(([kind, value]) => ({ kind, sessions: value.sessions, minutes: value.minutes }))
    // Minutes first, then kind, so equal totals order deterministically.
    .sort((a, b) => b.minutes - a.minutes || a.kind.localeCompare(b.kind));

  return {
    sessions: sessions.length,
    totalMinutes,
    averageMinutes:
      sessions.length === 0 ? null : Math.round((totalMinutes / sessions.length) * 10) / 10,
    byKind,
    activeDays: days.size,
    daysInRange: Math.max(1, Math.trunc(rangeDays)),
  };
}

/**
 * Whether a range had no mobility work at all.
 *
 * Used to tell the user "no sessions logged" as a neutral fact rather than presenting an
 * empty chart that reads as a failure.
 */
export function isQuietRange(sessions: readonly { logDate: DateKey }[]): boolean {
  return sessions.length === 0;
}

/** The `days` date keys ending at `end`, newest first. */
export function recentDateKeys(end: DateKey, days: number): DateKey[] {
  const span = Math.max(1, Math.trunc(days));
  return Array.from({ length: span }, (_, index) => addDays(end, -index));
}
