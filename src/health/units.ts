/**
 * Volume units for hydration.
 *
 * `water_logs.amount_ml` is an INTEGER, so every conversion has to resolve to whole
 * millilitres. Two units are exact and one is not:
 *
 * - millilitres and litres are exact (`1 L = 1000 ml`).
 * - A US fluid ounce is `29.5735295625 ml` *exactly* by definition, which is never a whole
 *   number. It is rounded to the nearest millilitre, so `8 floz` is 236 ml rather than
 *   236.19. That is a deliberate, sub-0.5 ml loss — far below anything a water log cares
 *   about, and recorded here rather than hidden.
 *
 * The conversion happens once, at the boundary. Nothing downstream ever holds a float.
 */

export type VolumeUnit = 'ml' | 'l' | 'floz';

/** Exact by definition: the US fluid ounce is 1/128 of a US gallon. */
export const ML_PER_FLUID_OUNCE = 29.5735295625;

/** Largest single entry accepted, in millilitres. Roughly four days of water. */
export const MAX_ENTRY_ML = 10_000;

export function toMillilitres(amount: number, unit: VolumeUnit): number {
  if (!Number.isFinite(amount)) return 0;
  const raw =
    unit === 'ml' ? amount : unit === 'l' ? amount * 1000 : amount * ML_PER_FLUID_OUNCE;
  return Math.round(raw);
}

/** Display helper. Rounding, never truncation: 0.4 L should read "400 ml". */
export function fromMillilitres(ml: number, unit: VolumeUnit): number {
  if (unit === 'ml') return ml;
  if (unit === 'l') return Math.round((ml / 1000) * 100) / 100;
  return Math.round((ml / ML_PER_FLUID_OUNCE) * 10) / 10;
}

/**
 * Parses a volume the user typed.
 *
 * Accepts a number with an optional unit suffix in either order and any capitalisation:
 * `"250"`, `"250ml"`, `"250 ml"`, `"1.5l"`, `"1.5 l"`, `"16oz"`, `"16 fl oz"`, `"16 floz"`.
 * A bare number is millilitres, which is the app's own unit and the least surprising.
 *
 * Returns `null` rather than throwing so the caller can show a field error. Parsing is
 * deliberately strict about the unit: guessing that "2 cups" means 500 ml would be an
 * invention, and hydration advice built on an invented conversion is worse than none.
 */
export function parseVolume(input: string): { ml: number; unit: VolumeUnit } | null {
  const text = input.trim().toLowerCase();
  if (text === '') return null;

  // Accept the unit either before or after the number ("ml 250" as well as "250 ml").
  const match = /^(?:(ml|l|oz|floz|fl\.?\s*oz)\s*)?([0-9]+(?:\.[0-9]+)?)\s*(ml|l|oz|floz|fl\.?\s*oz)?$/.exec(
    text,
  );
  if (!match) return null;

  const prefix = match[1];
  const suffix = match[3];
  const unitToken = suffix ?? prefix;
  const value = Number(match[2]);

  if (!Number.isFinite(value)) return null;

  const unit: VolumeUnit =
    unitToken === 'l' ? 'l' : unitToken === 'ml' ? 'ml' : unitToken === undefined ? 'ml' : 'floz';

  const ml = toMillilitres(value, unit);
  if (ml <= 0) return null;

  return { ml, unit };
}

/** Quick-add amounts offered on the hydration screen, in millilitres. */
export const QUICK_ADD_ML: readonly number[] = [250, 500, 750, 1000] as const;

/** Default daily target when the user has not set one. */
export const DEFAULT_DAILY_TARGET_ML = 2000;

/** Format for display: `1.5 L` above a litre, otherwise whole millilitres. */
export function formatVolume(ml: number, preferred: VolumeUnit = 'ml'): string {
  if (preferred === 'l' || ml >= 1000) {
    const litres = Math.round((ml / 1000) * 100) / 100;
    return `${litres} L`;
  }
  if (preferred === 'floz') {
    return `${Math.round((ml / ML_PER_FLUID_OUNCE))} oz`;
  }
  return `${ml} ml`;
}
