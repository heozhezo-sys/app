/**
 * Focus presets and cycle rules.
 *
 * The specification names three presets (25/5, 50/10, 90/20) plus custom. A long-focus
 * break is a deliberate addition: 90 minutes of work is not something to follow with a
 * 5-minute break, and a user who has to set that up manually every time is a user who
 * stops doing it.
 */

export type FocusKind = 'pomodoro' | 'short_focus' | 'long_focus' | 'custom';

export interface FocusPreset {
  kind: FocusKind;
  label: string;
  /** Focus length in minutes. */
  focusMinutes: number;
  /** Break length in minutes. */
  breakMinutes: number;
}

export const FOCUS_PRESETS: readonly FocusPreset[] = [
  { kind: 'pomodoro', label: '25 / 5', focusMinutes: 25, breakMinutes: 5 },
  { kind: 'short_focus', label: '50 / 10', focusMinutes: 50, breakMinutes: 10 },
  { kind: 'long_focus', label: '90 / 20', focusMinutes: 90, breakMinutes: 20 },
] as const;

/** The preset used when the caller does not choose one. */
export const DEFAULT_PRESET: FocusPreset = FOCUS_PRESETS[0] as FocusPreset;

/** Longest session accepted, in minutes. Bounds the input a user can create. */
export const MAX_FOCUS_MINUTES = 240;
/** Longest break accepted. */
export const MAX_BREAK_MINUTES = 120;

export interface PresetValidation {
  kind: FocusKind;
  focusMinutes: number;
  breakMinutes: number;
}

/**
 * Validates a requested preset or custom length.
 *
 * Returns a value rather than throwing, because the caller has to render a field error
 * against a specific input. Minutes are truncated rather than rounded: a user typing 25.7
 * meant 25, and silently rounding up to 26 would run the timer longer than they asked.
 */
export function validatePreset(input: {
  kind?: FocusKind;
  focusMinutes?: number;
  breakMinutes?: number;
}): { ok: true; value: PresetValidation } | { ok: false; field: 'focusMinutes' | 'breakMinutes'; message: string } {
  const kind = input.kind ?? DEFAULT_PRESET.kind;
  const base = FOCUS_PRESETS.find((preset) => preset.kind === kind) ?? DEFAULT_PRESET;

  const focusMinutes = truncateOrDefault(input.focusMinutes, base.focusMinutes);
  const breakMinutes = truncateOrDefault(input.breakMinutes, base.breakMinutes);

  if (!Number.isFinite(focusMinutes) || focusMinutes <= 0) {
    return { ok: false, field: 'focusMinutes', message: 'Enter a focus length in minutes.' };
  }
  if (focusMinutes > MAX_FOCUS_MINUTES) {
    return {
      ok: false,
      field: 'focusMinutes',
      message: `Sessions are limited to ${MAX_FOCUS_MINUTES} minutes.`,
    };
  }
  if (!Number.isFinite(breakMinutes) || breakMinutes < 0) {
    return { ok: false, field: 'breakMinutes', message: 'Enter a break length in minutes.' };
  }
  if (breakMinutes > MAX_BREAK_MINUTES) {
    return {
      ok: false,
      field: 'breakMinutes',
      message: `Breaks are limited to ${MAX_BREAK_MINUTES} minutes.`,
    };
  }

  return { ok: true, value: { kind, focusMinutes, breakMinutes } };
}

function truncateOrDefault(value: number | undefined, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number') return fallback;
  return Math.trunc(value);
}
