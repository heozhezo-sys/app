/**
 * Motion tokens.
 *
 * Durations are short and restrained. All animation is disabled when the user has
 * enabled Reduce Motion (`useReducedMotion`), so these values are only ever a
 * *ceiling*, never a mandate.
 */

export const motion = {
  /** Press feedback / small state flips. */
  fast: 120,
  /** Sheets, fades, most transitions. */
  normal: 220,
  /** Large, rare transitions. */
  slow: 360,
} as const;

export const easing = {
  standard: [0.4, 0.0, 0.2, 1] as const,
  decelerate: [0.0, 0.0, 0.2, 1] as const,
  accelerate: [0.4, 0.0, 1, 1] as const,
} as const;
