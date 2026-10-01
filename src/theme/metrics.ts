/**
 * Spacing, radii and hit-target tokens.
 *
 * The 4pt grid is deliberate. Values here are the only permitted spacing values.
 */

/** 4pt base scale. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export type SpacingKey = keyof typeof spacing;

export const radii = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

export type RadiusKey = keyof typeof radii;

/**
 * Minimum interactive size in points.
 * 44pt is the iOS HIG minimum; 48dp is the Material minimum. We use 48 everywhere
 * so a single value satisfies both platforms.
 */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const MIN_TOUCH_TARGET = 48;

/** Layout breakpoints (points). Small phones < 390 are common on Android. */
export const layout = {
  screenPadding: spacing.lg,
  maxContentWidth: 720,
  compactBreakpoint: 390,
  regularBreakpoint: 600,
} as const;
