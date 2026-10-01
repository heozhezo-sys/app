/**
 * Sleep time arithmetic.
 *
 * The schema stores `bedtime` and `wake_time` as absolute epochs with
 * `CHECK (wake_time >= bedtime)`. That check is only satisfiable if a night crossing
 * midnight is stored with the *correct dates* on both ends — a bedtime of 23:00 and a
 * wake time of 07:00 cannot both belong to the same date. Getting this wrong does not
 * produce a visible error; it produces a log that either fails to save or silently records
 * the wrong duration.
 *
 * The convention, stated once so it is testable: **a sleep log is keyed to the morning you
 * wake up.** `sleep_date` is the wake date, and a bedtime whose clock time is later than
 * the wake time therefore belongs to the previous evening.
 *
 * Pure functions, no clock of their own, so every case below is deterministic.
 */

/** `HH:MM`, 24-hour. */
export type ClockTime = string;

export interface SleepWindow {
  /** The date the user woke up on. */
  sleepDate: string;
  /** Absolute epoch ms. */
  bedtime: number;
  wakeTime: number;
  durationMin: number;
}

export type SleepResolution =
  | { ok: true; window: SleepWindow }
  | { ok: false; field: 'bedtime' | 'wakeTime' | 'duration'; message: string };

/** Longest sleep accepted, in minutes. Beyond this it is almost certainly a typo. */
export const MAX_SLEEP_MINUTES = 16 * 60;

/**
 * Builds absolute times from clock times.
 *
 * `sleepDate` is the wake date. When the bedtime's clock time is later than the wake
 * time, the bedtime belongs to the previous day; otherwise both are on the wake date.
 * That single comparison is what makes a 23:00 → 07:00 night work.
 */
export function resolveSleepWindow(input: {
  sleepDate: string;
  bedtime: ClockTime;
  wakeTime: ClockTime;
}): SleepResolution {
  const bedtime = parseClockTime(input.bedtime);
  if (!bedtime) {
    return { ok: false, field: 'bedtime', message: 'Enter a bedtime as HH:MM.' };
  }

  const wake = parseClockTime(input.wakeTime);
  if (!wake) {
    return { ok: false, field: 'wakeTime', message: 'Enter a wake time as HH:MM.' };
  }

  /*
   * A bedtime whose clock time is later than the wake time belongs to the previous
   * evening. Compared as minutes since midnight: comparing the parsed objects with `>`
   * would stringify both to "[object Object]" and always be false, silently turning every
   * cross-midnight night into a same-day one.
   */
  const crossesMidnight = minutesSinceMidnight(bedtime) > minutesSinceMidnight(wake);
  const bedtimeDate = crossesMidnight ? previousDate(input.sleepDate) : input.sleepDate;
  const bedtimeAt = epochFrom(bedtimeDate, bedtime);
  const wakeAt = epochFrom(input.sleepDate, wake);

  // Computed from the two epochs rather than assumed to be 24h, so a DST shift is honest.
  const durationMin = Math.round((wakeAt - bedtimeAt) / 60_000);

  if (durationMin <= 0) {
    return { ok: false, field: 'duration', message: 'Wake time must be after bedtime.' };
  }
  if (durationMin > MAX_SLEEP_MINUTES) {
    return {
      ok: false,
      field: 'duration',
      message: `That is longer than ${MAX_SLEEP_MINUTES / 60} hours. Check the times.`,
    };
  }

  return {
    ok: true,
    window: { sleepDate: input.sleepDate, bedtime: bedtimeAt, wakeTime: wakeAt, durationMin },
  };
}

/** Strict `HH:MM` parser. Rejects `25:00`, `7:5` and `7pm` rather than guessing. */
export function parseClockTime(value: string): { hours: number; minutes: number } | null {
  const match = /^([0-9]{1,2}):([0-9]{2})$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return { hours, minutes };
}

/** Formats an epoch as `HH:MM` in local time. */
export function formatClockTime(epochMs: number): ClockTime {
  const date = new Date(epochMs);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function minutesSinceMidnight(time: { hours: number; minutes: number }): number {
  return time.hours * 60 + time.minutes;
}

function previousDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  // Constructed from parts and then stepped, so month-end and leap days are handled by
  // `Date` rather than by hand.
  const date = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12);
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Epoch for a local `YYYY-MM-DD` and `HH:MM`. Noon avoids a DST boundary. */
function epochFrom(dateKey: string, time: { hours: number; minutes: number }): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(
    year ?? 1970,
    (month ?? 1) - 1,
    day ?? 1,
    time.hours,
    time.minutes,
    0,
    0,
  ).getTime();
}
/* ------------------------------------------------------------- statistics */

export interface SleepSummary {
  /** Nights logged. */
  nights: number;
  /** Mean duration in minutes, rounded. Zero when nothing is logged. */
  averageMinutes: number;
  /** Shortest and longest night, or null when nothing is logged. */
  shortestMinutes: number | null;
  longestMinutes: number | null;
}

/**
 * Average duration over the nights supplied.
 *
 * Derived from the log rather than accumulated, so an edited or deleted night cannot
 * leave a stale running total behind.
 */
export function summariseSleep(durations: number[]): SleepSummary {
  const valid = durations.filter((value) => Number.isFinite(value) && value > 0);
  if (valid.length === 0) {
    return {
      nights: 0,
      averageMinutes: 0,
      shortestMinutes: null,
      longestMinutes: null,
    };
  }

  const total = valid.reduce((sum, value) => sum + value, 0);
  return {
    nights: valid.length,
    averageMinutes: Math.round(total / valid.length),
    shortestMinutes: Math.min(...valid),
    longestMinutes: Math.max(...valid),
  };
}

/**
 * Night-to-night variation in minutes, as a plain spread.
 *
 * The specification asks for "consistency". The honest way to express that is the observed
 * spread rather than a score implying a judgement: a 40-minute spread tells the user
 * something actionable, and nothing is asserted about whether it is good. Fewer than three
 * nights cannot show a pattern, so this returns `null` rather than a number derived from
 * too little data.
 */
export function sleepConsistency(durations: number[]): number | null {
  const valid = durations.filter((value) => Number.isFinite(value) && value > 0);
  if (valid.length < 3) return null;
  return Math.max(...valid) - Math.min(...valid);
}

/** `7h 30m`, or `45m` under an hour. */
export function formatDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return hours === 0 ? `${mins}m` : `${hours}h ${mins}m`;
}
