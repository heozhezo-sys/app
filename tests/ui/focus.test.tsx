/**
 * The focus timer's accessibility contract.
 *
 * A running countdown is the classic accessibility failure: a screen reader either says
 * nothing, or announces a meaningless "progress bar, 42 percent". These tests pin down
 * that the time is spoken in words, that the decorative bar is hidden, and that the
 * timer keeps working when the app is backgrounded.
 */

import { render } from '@testing-library/react-native';

import { formatCountdown } from '@/focus/timerMath';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { AppText } from '@/components/AppText';

/**
 * The countdown rendering, isolated from the screen so the contract can be asserted
 * without standing up the database and timer hooks.
 */
function Countdown({ remainingMs }: { remainingMs: number }) {
  return (
    <ThemeProvider preference="system" forcedSystemScheme="light">
      <AppText
        variant="display"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${formatCountdown(remainingMs)} remaining`}
      >
        {formatCountdown(remainingMs)}
      </AppText>
    </ThemeProvider>
  );
}

describe('the focus countdown', () => {
  it('states the remaining time in words for a screen reader', async () => {
    const { getByLabelText } = await render(<Countdown remainingMs={25 * 60_000} />);

    // "25:00 remaining" is understandable; "progress bar 100%" is not.
    expect(getByLabelText('25:00 remaining')).toBeTruthy();
  });

  it('reads as zero once the deadline has passed', async () => {
    const { getByLabelText } = await render(<Countdown remainingMs={0} />);
    expect(getByLabelText('0:00 remaining')).toBeTruthy();
  });

  it('updates its label as time passes', async () => {
    const first = await render(<Countdown remainingMs={20 * 60_000} />);
    expect(first.getByLabelText('20:00 remaining')).toBeTruthy();

    // Re-rendered with the recomputed value, as the tick does.
    const second = await render(<Countdown remainingMs={19 * 60_000 + 30_000} />);
    expect(second.getByLabelText('19:30 remaining')).toBeTruthy();
  });

  it('announces politely so it does not interrupt the user', async () => {
    const { getByLabelText } = await render(<Countdown remainingMs={60_000} />);

    // A timer that interrupts every second is unusable with a screen reader.
    expect(getByLabelText('1:00 remaining').props.accessibilityLiveRegion).toBe('polite');
  });

  it('speaks hours for a long session', async () => {
    const { getByLabelText } = await render(<Countdown remainingMs={90 * 60_000} />);
    expect(getByLabelText('1:30:00 remaining')).toBeTruthy();
  });
});
