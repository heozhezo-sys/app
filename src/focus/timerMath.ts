/**
 * Focus-timer time arithmetic.
 *
 * Pure functions, no clock of their own and no state. Everything is derived from an
 * explicit `now`, which is what makes ADR-0005 true rather than merely intended: the
 * app stores a wall-clock deadline and recomputes elapsed time from the clock on every
 * read, so backgrounding, screen lock, suspension, process death and reopening all give
 * the same answer. An in-memory tick counter fails all four.
 *
 * Keeping this separate from the service also makes the awkward cases testable without a
 * database or a running app: a clock that jumps backwards, a session whose deadline
 * passed while the app was closed, and a session abandoned and restarted.
 */

/** A focus session's wall-clock shape, as stored in `focus_sessions`. */
export interface FocusWindow {
  startedAt: number;
  endsAt: number;
}

export interface TimerSnapshot {
  /** Milliseconds left. Never negative; zero means the deadline has passed. */
  remainingMs: number;
  /** Fraction of the planned window still to run, 0..1. */
  remainingFraction: number;
  /** True once `now` has reached or passed `endsAt`. */
  expired: boolean;
  /** Milliseconds since the window opened. */
  elapsedMs: number;
  /** Total planned length in milliseconds. */
  totalMs: number;
}

/**
 * Reads the timer at a given instant.
 *
 * A clock that has gone backwards — which happens when the device clock is corrected,
 * or across a timezone change — yields zero elapsed rather than a negative one. A
 * negative elapsed time would make the timer briefly claim more remaining than it
 * started with.
 */
export function readTimer(window: FocusWindow, now: number): TimerSnapshot {
  const totalMs = Math.max(0, window.endsAt - window.startedAt);

  // Both ends are clamped to the window. Without this, a device clock that moves
  // backwards makes the timer claim more time remaining than the session ever had, and
  // `remainingFraction` would exceed 1.
  const remainingMs = Math.min(totalMs, Math.max(0, window.endsAt - now));
  const elapsedMs = Math.min(totalMs, Math.max(0, now - window.startedAt));

  return {
    remainingMs,
    remainingFraction: totalMs === 0 ? 0 : remainingMs / totalMs,
    expired: now >= window.endsAt,
    elapsedMs,
    totalMs,
  };
}

/** Formats a remaining duration as `M:SS`, or `H:MM:SS` past an hour. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  const pad = (value: number): string => value.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * Minutes a session ran for, given when it started and when it was resolved.
 *
 * `endedAt` is passed in rather than read from a clock so the value is reproducible in
 * tests, and so completing a session does not depend on when the code happened to run.
 */
export function elapsedMinutes(window: FocusWindow, endedAt: number): number {
  return Math.max(0, Math.round((endedAt - window.startedAt) / 60_000));
}

/**
 * Whether a session that is still marked active has already run out.
 *
 * This is the recovery check the app runs on launch: a session left `active` whose
 * deadline passed while the process was dead is finished, not pending. The app must not
 * silently resume a timer for time the user did not have the app open.
 */
export function isStaleActive(window: FocusWindow, now: number): boolean {
  return now >= window.endsAt;
}

/**
 * How much of a planned session was actually used, as 0..1.
 *
 * Used for statistics only. Capped at 1 because a session resolved after its deadline
 * cannot have used more than the whole window.
 */
export function completionRatio(window: FocusWindow, endedAt: number): number {
  const totalMs = Math.max(0, window.endsAt - window.startedAt);
  if (totalMs === 0) return 0;
  return Math.min(1, Math.max(0, (endedAt - window.startedAt) / totalMs));
}
