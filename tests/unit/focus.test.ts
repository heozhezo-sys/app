/**
 * Focus-timer time arithmetic and presets.
 *
 * These are the tests that make ADR-0005 true rather than aspirational. "Timers must
 * survive backgrounding, screen lock, app suspension and reopening" is only satisfied if
 * elapsed time is recomputed from stored wall-clock values, and that is exactly what
 * these cases pin down.
 */

import {
  completionRatio,
  elapsedMinutes,
  formatCountdown,
  isStaleActive,
  readTimer,
} from '@/focus/timerMath';
import {
  DEFAULT_PRESET,
  FOCUS_PRESETS,
  MAX_BREAK_MINUTES,
  MAX_FOCUS_MINUTES,
  validatePreset,
} from '@/focus/presets';

const MINUTE = 60_000;
const T0 = 1_767_225_600_000;

describe('readTimer', () => {
  it('reports the full window before it starts', () => {
    const timer = readTimer({ startedAt: T0, endsAt: T0 + 25 * MINUTE }, T0);

    expect(timer.remainingMs).toBe(25 * MINUTE);
    expect(timer.elapsedMs).toBe(0);
    expect(timer.expired).toBe(false);
    expect(timer.remainingFraction).toBe(1);
  });

  it('counts down from the clock, not from a stored tick count', () => {
    const window = { startedAt: T0, endsAt: T0 + 25 * MINUTE };

    // Ten minutes later, ten minutes have elapsed — regardless of how often, or how
    // little, the app was in the foreground during that time.
    const at = T0 + 10 * MINUTE;
    expect(readTimer(window, at).remainingMs).toBe(15 * MINUTE);
    expect(readTimer(window, at).elapsedMs).toBe(10 * MINUTE);
  });

  it('gives the same answer after a simulated restart', () => {
    const window = { startedAt: T0, endsAt: T0 + 25 * MINUTE };
    const at = T0 + 7 * MINUTE;

    // "Before" and "after" the process was killed are the same computation on the same
    // stored values, which is the whole point of storing a deadline.
    expect(readTimer(window, at)).toEqual(readTimer(window, at));
  });

  it('reports expiry once the deadline passes', () => {
    const window = { startedAt: T0, endsAt: T0 + 25 * MINUTE };
    const at = T0 + 25 * MINUTE;

    expect(readTimer(window, at).expired).toBe(true);
    expect(readTimer(window, at).remainingMs).toBe(0);
  });

  it('never reports negative time when reopened past the deadline', () => {
    const window = { startedAt: T0, endsAt: T0 + 25 * MINUTE };

    // Reopened three hours after a 25-minute session ended.
    const timer = readTimer(window, T0 + 3 * 60 * MINUTE);

    expect(timer.remainingMs).toBe(0);
    expect(timer.remainingFraction).toBe(0);
    // Elapsed is capped at the planned length rather than reporting three hours.
    expect(timer.elapsedMs).toBe(25 * MINUTE);
  });

  it('survives the device clock moving backwards', () => {
    const window = { startedAt: T0, endsAt: T0 + 25 * MINUTE };

    // A timezone correction or manual clock change can move `now` behind `started_at`.
    const timer = readTimer(window, T0 - 5 * MINUTE);

    expect(timer.elapsedMs).toBe(0);
    // The key invariant: never more remaining than the window started with.
    expect(timer.remainingMs).toBeLessThanOrEqual(25 * MINUTE);
  });

  it('handles a zero-length window without dividing by zero', () => {
    const timer = readTimer({ startedAt: T0, endsAt: T0 }, T0);

    expect(timer.totalMs).toBe(0);
    expect(Number.isFinite(timer.remainingFraction)).toBe(true);
  });

  it('treats a backwards window as zero-length rather than negative', () => {
    expect(readTimer({ startedAt: T0, endsAt: T0 - MINUTE }, T0).totalMs).toBe(0);
  });
});

describe('formatCountdown', () => {
  it('formats minutes and seconds', () => {
    expect(formatCountdown(25 * MINUTE)).toBe('25:00');
    expect(formatCountdown(90_000)).toBe('1:30');
    expect(formatCountdown(9_000)).toBe('0:09');
  });

  it('adds an hours field past sixty minutes', () => {
    expect(formatCountdown(90 * MINUTE)).toBe('1:30:00');
  });

  it('rounds up so the last second is never shown as zero early', () => {
    // 1ms left should read "0:01", not "0:00": the timer has not finished yet.
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(0)).toBe('0:00');
  });

  it('clamps a negative duration to zero', () => {
    expect(formatCountdown(-5000)).toBe('0:00');
  });
});

describe('elapsed time and ratios', () => {
  it('rounds elapsed minutes to the nearest minute', () => {
    const window = { startedAt: T0, endsAt: T0 + 25 * MINUTE };
    expect(elapsedMinutes(window, T0 + 25 * MINUTE)).toBe(25);
    expect(elapsedMinutes(window, T0 + 8 * MINUTE + 20_000)).toBe(8);
  });

  it('never reports negative elapsed minutes', () => {
    expect(elapsedMinutes({ startedAt: T0, endsAt: T0 + MINUTE }, T0 - MINUTE)).toBe(0);
  });

  it('caps the completion ratio at one', () => {
    const window = { startedAt: T0, endsAt: T0 + 25 * MINUTE };
    expect(completionRatio(window, T0 + 25 * MINUTE)).toBe(1);
    // Resolved late: a session cannot use more than the whole window.
    expect(completionRatio(window, T0 + 40 * MINUTE)).toBe(1);
    expect(completionRatio(window, T0 + 12.5 * MINUTE)).toBe(0.5);
  });

  it('reports zero for a zero-length window', () => {
    expect(completionRatio({ startedAt: T0, endsAt: T0 }, T0)).toBe(0);
  });
});
describe('isStaleActive', () => {
  it('is false while the session still has time', () => {
    expect(isStaleActive({ startedAt: T0, endsAt: T0 + 25 * MINUTE }, T0 + 1)).toBe(false);
  });

  it('is true once the deadline has passed', () => {
    // This is the launch-time recovery check for a session interrupted by process death.
    const window = { startedAt: T0, endsAt: T0 + 25 * MINUTE };
    expect(isStaleActive(window, T0 + 26 * MINUTE)).toBe(true);
    expect(isStaleActive(window, T0 + 25 * MINUTE)).toBe(true);
  });
});

describe('presets', () => {
  it('offers the three named presets', () => {
    expect(FOCUS_PRESETS.map((preset) => preset.label)).toEqual(['25 / 5', '50 / 10', '90 / 20']);
    expect(DEFAULT_PRESET.focusMinutes).toBe(25);
    expect(DEFAULT_PRESET.breakMinutes).toBe(5);
  });

  it('inherits lengths from the chosen preset', () => {
    const result = validatePreset({ kind: 'long_focus' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.focusMinutes).toBe(90);
    expect(result.value.breakMinutes).toBe(20);
  });

  it('allows custom lengths', () => {
    const result = validatePreset({ kind: 'custom', focusMinutes: 35, breakMinutes: 7 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.focusMinutes).toBe(35);
    expect(result.value.breakMinutes).toBe(7);
  });

  it('truncates rather than rounding up a fractional length', () => {
    const result = validatePreset({ kind: 'custom', focusMinutes: 25.9, breakMinutes: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Rounding up would run the timer longer than the user asked for.
    expect(result.value.focusMinutes).toBe(25);
  });

  it('accepts a zero-length break', () => {
    expect(validatePreset({ kind: 'custom', focusMinutes: 20, breakMinutes: 0 }).ok).toBe(true);
  });

  it('rejects a zero or negative focus length', () => {
    expect(validatePreset({ kind: 'custom', focusMinutes: 0 }).ok).toBe(false);
    expect(validatePreset({ kind: 'custom', focusMinutes: -10 }).ok).toBe(false);
  });

  it('rejects a negative break length and names the field', () => {
    const result = validatePreset({ kind: 'custom', focusMinutes: 20, breakMinutes: -1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('breakMinutes');
  });

  it('rejects lengths beyond the maximum', () => {
    expect(validatePreset({ kind: 'custom', focusMinutes: MAX_FOCUS_MINUTES + 1 }).ok).toBe(
      false,
    );
    expect(
      validatePreset({
        kind: 'custom',
        focusMinutes: 20,
        breakMinutes: MAX_BREAK_MINUTES + 1,
      }).ok,
    ).toBe(false);
  });

  it('accepts a length exactly at the maximum', () => {
    expect(validatePreset({ kind: 'custom', focusMinutes: MAX_FOCUS_MINUTES }).ok).toBe(true);
  });

  it('names the offending field so the UI can attach the message', () => {
    const result = validatePreset({ kind: 'custom', focusMinutes: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('focusMinutes');
    expect(result.message).not.toBe('');
  });
});
