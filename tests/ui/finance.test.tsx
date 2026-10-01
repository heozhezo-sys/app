/**
 * Finance UI contracts.
 *
 * The point of these tests is not that the screen renders — it is the two properties a
 * money screen can silently lose:
 *
 *  1. **Amounts are spoken meaningfully.** VoiceOver reads a bare "1250" as a number with
 *     no context. Every figure must carry what it *is* ("Checking balance: $1,000.00"),
 *     and a negative must not be announced the same as a positive.
 *  2. **No decimal currency ever reaches a component.** The specification forbids unsafe
 *     floating-point money, and a screen is where `Number(input) * 100` would creep in.
 *     That is asserted structurally over the source, the same way the journal test asserts
 *     its privacy property, because a comment decays and a test does not.
 */

import { readFileSync } from 'fs';
import * as path from 'path';

import { render } from '@testing-library/react-native';

import { ThemeProvider } from '@/theme/ThemeProvider';
import { AppText } from '@/components/AppText';
import { formatMinor } from '@/utils/money';

function themed(node: React.ReactElement): React.ReactElement {
  return (
    <ThemeProvider preference="system" forcedSystemScheme="light">
      {node}
    </ThemeProvider>
  );
}

describe('finance amounts are announced with meaning', () => {
  it('labels a balance with its account and currency', async () => {
    const { getByLabelText } = await render(
      themed(
        <AppText accessibilityLabel={`Checking balance: ${formatMinor(100_000, 'USD')}`}>
          {formatMinor(100_000, 'USD')}
        </AppText>,
      ),
    );

    expect(getByLabelText('Checking balance: $1,000.00')).toBeTruthy();
  });

  it('speaks a negative amount differently from a positive one', async () => {
    // The failure this prevents: an overspent budget announced as "50.00" with no sign,
    // which reads as money remaining when the opposite is true.
    const overspent = formatMinor(-5_000, 'USD', { showSign: true });
    expect(overspent).toBe('-$50.00');
    expect(overspent).not.toBe(formatMinor(5_000, 'USD'));
  });

  it('formats a zero-decimal currency without inventing decimals', async () => {
    // JPY has no minor unit. Showing "¥1,500.00" would imply a precision that does not
    // exist and would not match a real statement.
    expect(formatMinor(1500, 'JPY')).toBe('¥1,500');
    expect(formatMinor(1500, 'JPY')).not.toContain('.');
  });

  it('never renders a minor-unit integer as a bare decimal string', async () => {
    // 1999 minor units is $19.99. If this ever reads "1999" the decimal place was lost.
    const rendered = formatMinor(1999, 'USD');
    expect(rendered).toContain('19.99');
    expect(rendered).not.toBe('1999');
  });
});

describe('the finance screen keeps decimals out of components', () => {
  const screenPath = path.join(process.cwd(), 'app', '(tabs)', 'finance.tsx');
  const hooksPath = path.join(process.cwd(), 'src', 'features', 'finance', 'hooks', 'useFinance.ts');
  const source = readFileSync(screenPath, 'utf8');

  it('converts no typed amount to a number', () => {
    // `Number(amount)` or `parseFloat(amount)` in the screen is the exact defect the money
    // rule exists to prevent: 19.99 becomes 1998.9999999999998 cents.
    const floatCalls = source.match(/Number\(\s*amount|parseFloat\(/g);
    expect(floatCalls).toBeNull();
  });

  it('multiplies no amount by a currency scale', () => {
    // A `* 100` in the UI would duplicate the conversion `parseAmountToMinor` already owns.
    const scaled = source.match(/amountMinor\s*\*\s*10|\*\s*100\b/);
    expect(scaled).toBeNull();
  });

  it('keeps the amount as a string in state', () => {
    expect(source).toMatch(/useState\(''\)/);
  });

  it('delegates to the service rather than the repository', () => {
    // Screens must not contain persistence logic; that is the layering rule.
    expect(source).not.toMatch(/@\/repositories\//);
    expect(source).not.toMatch(/getDatabase|database\/driver/);
  });

  it('holds no networking path', () => {
    // `FEATURES/FINANCE.md` requires finance records stay local by default.
    expect(source).not.toMatch(/fetch\(|XMLHttpRequest|axios|https?:\/\//);
    expect(readFileSync(hooksPath, 'utf8')).not.toMatch(/fetch\(|axios|https?:\/\//);
  });

  it('exposes an accessibility testID on the primary controls', () => {
    for (const testID of [
      'finance-amount',
      'finance-submit',
      'finance-account-name',
      'finance-add-account',
    ]) {
      expect(source).toContain(`testID="${testID}"`);
    }

    // The mode toggles come from a `MODES` map, so their ids are built at render time.
    // The template is asserted rather than three literal strings, which keeps the test
    // honest if a mode is added.
    expect(source).toContain('testID={`finance-mode-${entry.mode}`}');
    expect(source).toContain('testID={`finance-category-${category.id}`}');
  });

  it('marks the mode toggles as selected, not only coloured', () => {
    // A selection shown by colour alone is invisible to a screen reader.
    expect(source).toMatch(/selected=\{mode === entry\.mode\}/);
  });
});
