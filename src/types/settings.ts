/** Durable user preferences. Persisted as JSON in the `preferences` table. */

export type AppearancePreference = 'system' | 'light' | 'dark';

export type VolumeUnit = 'ml' | 'l' | 'oz';

export type WeightUnit = 'kg' | 'lb';

export type LengthUnit = 'cm' | 'in';

export type TemperatureUnit = 'c' | 'f';

export type WeekStartPreference = 'monday' | 'sunday';

/** Default theme used on very first launch, before Settings exists. */
export const DEFAULT_SETTINGS: Settings = {
  appearance: 'system',
  volumeUnit: 'ml',
  weightUnit: 'kg',
  lengthUnit: 'cm',
  temperatureUnit: 'c',
  currency: 'USD',
  weekStartsOn: 'monday',
  hydrationTargetMl: 2500,
  dailyHabitGoal: 3,
  onboardingCompleted: false,
  journalLockEnabled: false,
  reduceMotionOverride: false,
  notificationsEnabled: false,
};

export interface Settings {
  appearance: AppearancePreference;
  volumeUnit: VolumeUnit;
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
  temperatureUnit: TemperatureUnit;
  /** ISO-4217. Money is always stored in minor units of this currency. */
  currency: string;
  weekStartsOn: WeekStartPreference;
  hydrationTargetMl: number;
  /** User's own target for habits per day. Used for gentle pacing feedback. */
  dailyHabitGoal: number;
  onboardingCompleted: boolean;
  /** Require biometric or device authentication before showing journal entries. */
  journalLockEnabled: boolean;
  /** Force reduced motion regardless of the OS setting. */
  reduceMotionOverride: boolean;
  notificationsEnabled: boolean;
}

/** Merge persisted JSON over defaults so a new field never breaks an old install. */
export function normaliseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS };
  const input = raw as Partial<Record<keyof Settings, unknown>>;

  const pickEnum = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

  return {
    appearance: pickEnum(input.appearance, ['system', 'light', 'dark'] as const, 'system'),
    volumeUnit: pickEnum(input.volumeUnit, ['ml', 'l', 'oz'] as const, 'ml'),
    weightUnit: pickEnum(input.weightUnit, ['kg', 'lb'] as const, 'kg'),
    lengthUnit: pickEnum(input.lengthUnit, ['cm', 'in'] as const, 'cm'),
    temperatureUnit: pickEnum(input.temperatureUnit, ['c', 'f'] as const, 'c'),
    currency:
      typeof input.currency === 'string' && /^[A-Z]{3}$/.test(input.currency)
        ? input.currency
        : 'USD',
    weekStartsOn: pickEnum(input.weekStartsOn, ['monday', 'sunday'] as const, 'monday'),
    hydrationTargetMl:
      typeof input.hydrationTargetMl === 'number' &&
      Number.isFinite(input.hydrationTargetMl) &&
      input.hydrationTargetMl > 0
        ? Math.round(input.hydrationTargetMl)
        : 2500,
    dailyHabitGoal:
      typeof input.dailyHabitGoal === 'number' &&
      Number.isInteger(input.dailyHabitGoal) &&
      input.dailyHabitGoal >= 1 &&
      input.dailyHabitGoal <= 50
        ? input.dailyHabitGoal
        : 3,
    onboardingCompleted: input.onboardingCompleted === true,
    journalLockEnabled: input.journalLockEnabled === true,
    reduceMotionOverride: input.reduceMotionOverride === true,
    notificationsEnabled: input.notificationsEnabled === true,
  };
}
