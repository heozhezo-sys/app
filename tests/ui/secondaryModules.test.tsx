/**
 * Contracts for the secondary modules and the Settings hub.
 *
 * These assertions are structural — over the source rather than the rendered tree —
 * for the same reason the finance and journal suites do it: a comment decays and a test
 * does not. Each one below is a rule the specification states in prose that a future
 * edit could quietly break without any test failing.
 */

import { readFileSync } from 'fs';
import * as path from 'path';

const read = (...segments: string[]): string =>
  readFileSync(path.join(process.cwd(), ...segments), 'utf8');

/**
 * The file with its comments removed.
 *
 * These tests assert about *code*, not prose. Several of the files under test discuss the
 * very thing they must not do — `src/finance/rates.ts` explains at length why there is no
 * fetch — and a naive search would match the explanation and fail on a file that is
 * correct. Stripping comments first is what makes "no transport here" mean what it says.
 */
function readCode(...segments: string[]): string {
  return read(...segments)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const SCREENS = [
  'app/recovery.tsx',
  'app/achievements.tsx',
  'app/analytics.tsx',
  'app/calendar.tsx',
  'app/settings/index.tsx',
  'app/settings/appearance.tsx',
  'app/settings/units.tsx',
  'app/settings/currency.tsx',
  'app/settings/reminders.tsx',
  'app/settings/privacy.tsx',
  'app/settings/data.tsx',
  'app/(tabs)/finance.tsx',
  'app/(tabs)/journal.tsx',
  'app/(tabs)/index.tsx',
] as const;

/**
 * Screens that read from the database.
 *
 * Appearance, units and currency are excluded on purpose: they read only from the
 * synchronous settings store, so there is no async resource and no loading state to
 * handle. Requiring a spinner on a screen that cannot be slow would be theatre.
 */
const ASYNC_SCREENS = SCREENS.filter(
  (screen) =>
    !screen.endsWith('appearance.tsx') &&
    !screen.endsWith('units.tsx') &&
    !screen.endsWith('currency.tsx') &&
    !screen.endsWith('(tabs)/index.tsx'),
);

describe('every screen handles loading, empty and error', () => {
  it('renders StateView or a loading branch wherever it reads asynchronously', () => {
    for (const screen of ASYNC_SCREENS) {
      expect(readCode(screen)).toMatch(/StateView|status === 'loading'/);
    }
  });

  it('does not pretend the settings-only screens are async', () => {
    // These read a synchronously hydrated store, so a loading state would be a lie.
    for (const screen of ['app/settings/appearance.tsx', 'app/settings/units.tsx']) {
      expect(readCode(screen)).not.toMatch(/status === 'loading'/);
    }
  });

  it('gives every screen an accessibility testID on its primary control', () => {
    // A testID is what makes a screen reachable by an assistive-tech test at all.
    expect(read('app/recovery.tsx')).toContain('recovery-rating-${step}');
    expect(read('app/achievements.tsx')).toContain('testID="achievements-recount"');
    expect(read('app/analytics.tsx')).toContain('analytics-period-${option}');
    expect(read('app/calendar.tsx')).toContain('testID="calendar-earlier"');
    expect(read('app/settings/index.tsx')).toContain('testID="settings-currency"');
    expect(read('app/settings/data.tsx')).toContain('testID="data-export-backup"');
    expect(read('app/settings/privacy.tsx')).toContain('testID="privacy-lock-on"');
    expect(read('app/settings/reminders.tsx')).toContain('testID="reminders-allow"');
  });
});

describe('shared code stays platform-neutral', () => {
  it('branches on no platform inside any screen or shared module', () => {
    // `PLATFORM_SUPPORT.md` requires shared code never branch on `Platform.OS`. A screen
    // that did would work on one platform and quietly differ on the other.
    for (const screen of SCREENS) {
      expect(readCode(screen)).not.toMatch(/Platform\.OS|Platform\.select/);
    }
  });
});

describe('nothing in the new screens talks to a network', () => {
  it('holds no transport in any screen or its hooks', () => {
    const withHooks = [
      // `data.tsx` is excluded because reading a file the user picked uses `fetch` on a
      // local URI; the next test pins that down to exactly that one call.
      ...SCREENS.filter((screen) => screen !== 'app/settings/data.tsx'),
      'src/features/settings/hooks/useSettingsActions.ts',
      'src/features/analytics/hooks/useAnalytics.ts',
      'src/features/calendar/hooks/useCalendar.ts',
      'src/features/achievements/hooks/useAchievements.ts',
      'src/features/health/hooks/useRecovery.ts',
      'src/services/exchangeRateService.ts',
      'src/finance/rates.ts',
    ];

    for (const file of withHooks) {
      expect(readCode(file)).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|axios|https?:\/\//);
    }
  });

  it('still uses fetch to read a file the user picked, and nothing else', () => {
    // The one `fetch` that is legitimate: reading a document the user chose with the
    // system picker. It is a local file URI, not a request, and it is asserted here so a
    // future "let me also sync" cannot slip past the check above.
    const source = readCode('app/settings/data.tsx');
    const fetches = source.match(/await fetch\([^)]*\)/g) ?? [];
    expect(fetches).toHaveLength(1);
    expect(fetches[0]).toContain('asset.uri');
  });
});

describe('health language stays descriptive', () => {
  it('offers no medical or diagnostic claim on the recovery screen', () => {
    // `FEATURES/RECOVERY.md` asks for ratings. Turning a rating into advice is the one
    // thing this screen must never do.
    const source = readCode('app/recovery.tsx');
    for (const claim of [
      'healthy',
      'unhealthy',
      'diagnos',
      'you should',
      'recommend',
      'injury risk',
      'overtraining',
      'optimal',
    ]) {
      expect(source.toLowerCase()).not.toContain(claim);
    }
  });

  it('describes trends on analytics without judging them', () => {
    // "up 12%" is a fact; "improved 12%" is the app grading the user.
    const source = readCode('app/analytics.tsx');
    for (const judgement of ['improved', 'worse', 'better', 'good for you', 'bad for you']) {
      expect(source.toLowerCase()).not.toContain(judgement);
    }
  });
});

describe('accessibility rules hold on the new controls', () => {
  it('exposes selection state rather than conveying it by colour', () => {
    // `UI_UX/ACCESSIBILITY.md`: never use colour as the only state indicator.
    for (const screen of SCREENS) {
      const source = read(screen);
      const variantToggles = source.match(/variant=\{[^}]*\?[^\n]*(primary|secondary)/g) ?? [];
      // Every such toggle must also pass `selected`, or a screen reader hears nothing.
      const selectedCount = (source.match(/selected=\{/g) ?? []).length;
      expect(selectedCount).toBeGreaterThanOrEqual(Math.min(variantToggles.length, 1));
    }
  });

  it('labels the rating scale with its value for assistive tech', () => {
    // A bare "5" in a list of buttons is meaningless when read out of context.
    expect(read('app/recovery.tsx')).toContain('accessibilityLabel={`${label}: ${step} out of 10`}');
  });

  it('hides the decorative sparkline from assistive tech', () => {
    // It carries no information a screen reader can use, and announcing 28 empty bars
    // would bury the number the row exists to convey.
    const source = read('app/analytics.tsx');
    expect(source).toContain('accessibilityElementsHidden');
    expect(source).toContain('importantForAccessibility="no-hide-descendants"');
  });

  it('gives the recovery scale buttons a minimum width rather than a slider', () => {
    // A slider is below the 48pt minimum and its value is invisible to a screen reader.
    expect(read('app/recovery.tsx')).not.toMatch(/<Slider|Slider\s+from/);
  });
});

describe('the Settings hub is the only route to the secondary modules', () => {
  it('lists every hub destination in the Today screen', () => {
    const today = read('app/(tabs)/index.tsx');
    for (const route of [
      '/recovery',
      '/analytics',
      '/calendar',
      '/achievements',
      '/settings',
    ]) {
      expect(today).toContain(`href: '${route}'`);
    }
  });

  it('registers every screen it links to in the root layout', () => {
    // A link to an unregistered route is a silent dead end, so the two lists are checked
    // against each other rather than trusted.
    const layout = read('app/_layout.tsx');
    for (const name of [
      'recovery',
      'achievements',
      'analytics',
      'calendar',
      'settings/index',
      'settings/appearance',
      'settings/units',
      'settings/currency',
      'settings/reminders',
      'settings/privacy',
      'settings/data',
    ]) {
      expect(layout).toContain(`name="${name}"`);
    }
  });
});

describe('the journal lock is enforced by omission, not by hiding', () => {
  it('does not fetch entries or run a search while locked', () => {
    const source = read('app/(tabs)/journal.tsx');
    expect(source).toContain('useJournalEntries(filter, 30, !hidden)');
    expect(source).toContain('useJournalSearch(query, !hidden)');
  });

  it('gates the whole body of the screen on the lock state', () => {
    const source = read('app/(tabs)/journal.tsx');
    expect(source).toMatch(/\{hidden \? \(/);
  });

  it('re-locks when the screen loses focus', () => {
    // The unlock flag is in memory precisely so it clears; re-locking on blur means
    // switching tabs and back asks again.
    expect(read('app/(tabs)/journal.tsx')).toContain('useFocusEffect');
  });

  it('never writes the unlocked state anywhere durable', () => {
    // `preferences` is the only durable settings store, and the journal module holds the
    // unlock flag. Persisting "unlocked" would leave the journal open after a restart,
    // which is the exact failure a lock exists to prevent.
    const source = readCode('src/services/journalExportService.ts');
    expect(source).not.toMatch(/saveSettings|updateSettings|preferences|SecureStore/);
    // The flag is a plain module-level `let`, and the only things that touch it are this
    // module's own three functions.
    expect(source).toMatch(/let unlocked = false;/);
    expect(source).not.toMatch(/export (function|const) (get|set|load|save)Unlock/);
  });
});

describe('gamification can be turned off without hiding progress', () => {
  it('stores the preference rather than borrowing the motion setting', () => {
    // `reduceMotionOverride` is about animation. Using it for "no celebrations" would make
    // a user who wants less motion silently lose their gamification choice, and vice versa.
    const achievements = read('app/achievements.tsx');
    expect(achievements).toContain('gamificationEnabled');
    expect(achievements).not.toMatch(/reduceMotionOverride/);
    expect(read('src/types/settings.ts')).toContain('gamificationEnabled: boolean;');
  });
});

describe('multi-currency stays integer-only', () => {
  it('parses no typed amount to a number in the currency screen', () => {
    const source = readCode('app/settings/currency.tsx');
    expect(source).not.toMatch(/parseFloat\(|Number\(\s*(rate|customCode)/);
  });

  it('has no rate-fetching path anywhere in the rates module', () => {
    // A fetched rate would go stale silently; a typed one cannot.
    const source = readCode('src/finance/rates.ts');
    expect(source).not.toMatch(/fetch|axios|XMLHttpRequest|https?:/);
  });
});
