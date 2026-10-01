/**
 * LifeOS colour tokens.
 *
 * Every colour used anywhere in the app must come from this file. Raw hex values
 * elsewhere are a lint-level defect (see ADR-0002).
 *
 * Contrast: all `text`/`textMuted` pairs on their intended backgrounds meet or
 * exceed WCAG AA (4.5:1) for body text; `textFaint` is reserved for non-essential
 * decoration only.
 */

export interface Palette {
  /** Screen background. */
  background: string;
  /** Raised surface: cards, sheets, list rows. */
  surface: string;
  /** Surface on top of a surface (nested card, input fill). */
  surfaceAlt: string;
  /** Hairline separators. */
  border: string;
  /** Stronger border for focused/selected states. */
  borderStrong: string;

  /** Primary body text. */
  text: string;
  /** Secondary text. */
  textMuted: string;
  /** Tertiary text. Use only for non-essential decoration. */
  textFaint: string;
  /** Text drawn on top of `accent`. */
  onAccent: string;

  /** Primary interactive colour. */
  accent: string;
  /** Pressed state of `accent`. */
  accentPressed: string;
  /** Low-intensity accent wash for selected rows and chips. */
  accentSoft: string;

  /** Positive / completed. */
  success: string;
  successSoft: string;
  /** Warning / needs attention. */
  warning: string;
  warningSoft: string;
  /** Destructive / delete. */
  danger: string;
  dangerSoft: string;
  /** Informational. */
  info: string;
  infoSoft: string;

  /** Scrim behind modals. */
  scrim: string;

  /** Reader page background (theme-dependent, see `src/pdf/themes.ts`). */
  readerPage: string;
}

export const lightPalette: Palette = {
  background: '#F7F8FA',
  surface: '#FFFFFF',
  surfaceAlt: '#F1F3F6',
  border: '#E3E7ED',
  borderStrong: '#C3CBD6',

  text: '#111721',
  textMuted: '#5A6472',
  textFaint: '#8C95A3',
  onAccent: '#FFFFFF',

  accent: '#2563EB',
  accentPressed: '#1D4FD8',
  accentSoft: '#E6EEFE',

  success: '#0F7B4F',
  successSoft: '#E3F5EC',
  warning: '#9A6400',
  warningSoft: '#FDF1DC',
  danger: '#C02626',
  dangerSoft: '#FCE8E8',
  info: '#0B6E99',
  infoSoft: '#E3F2FA',

  scrim: 'rgba(17, 23, 33, 0.45)',
  readerPage: '#FFFFFF',
};

export const darkPalette: Palette = {
  background: '#0B0F14',
  surface: '#141A22',
  surfaceAlt: '#1C242E',
  border: '#26303C',
  borderStrong: '#3A4756',

  text: '#ECF1F7',
  textMuted: '#9AA6B6',
  textFaint: '#6B7787',
  onAccent: '#FFFFFF',

  accent: '#5B8DEF',
  accentPressed: '#7BA5F5',
  accentSoft: '#1B2740',

  success: '#3FBF8F',
  successSoft: '#122A22',
  warning: '#E0A93B',
  warningSoft: '#2C2314',
  danger: '#F06A6A',
  dangerSoft: '#301A1A',
  info: '#4FB3E6',
  infoSoft: '#12242E',

  scrim: 'rgba(0, 0, 0, 0.6)',
  readerPage: '#12161C',
};

/** Semantic colours for each habit / goal / category type. */
export const seriesColors = [
  '#2563EB',
  '#0F7B4F',
  '#9A6400',
  '#7C3AED',
  '#0B6E99',
  '#BE185D',
  '#0F766E',
  '#B45309',
] as const;

export function seriesColor(index: number): string {
  const len = seriesColors.length;
  const i = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
  return seriesColors[i % len] ?? seriesColors[0];
}
