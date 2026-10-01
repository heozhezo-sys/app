/**
 * Typography tokens.
 *
 * Dynamic Type (iOS) and Android font scaling are honoured: React Native scales
 * `Text` by the OS setting by default and we deliberately leave `allowFontScaling`
 * enabled everywhere. We only cap the multiplier so that accessibility sizes do
 * not shatter dense layouts (verified in `tests/ui/typography.test.tsx`).
 *
 * Font sizes are *unscaled base points*. The OS multiplies them.
 */

import type { TextStyle } from 'react-native';

export const fontFamily = {
  /** System font. Resolves to SF on iOS and Roboto on Android automatically. */
  regular: undefined as string | undefined,
  mono: 'monospace' as const,
};

export type TypeScaleKey =
  | 'display'
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'callout'
  | 'caption'
  | 'micro';

/**
 * Upper bound for OS font scaling. 2.0 honours every iOS accessibility size that
 * users realistically enable while keeping dense rows from overflowing.
 */
export const MAX_FONT_SCALE = 2.0;

interface TypeStyle extends TextStyle {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  fontWeight: TextStyle['fontWeight'];
}

export const typography: Record<TypeScaleKey, TypeStyle> = {
  // Large screen titles (iOS largeTitle style).
  display: { fontSize: 34, lineHeight: 41, letterSpacing: 0.25, fontWeight: '700' },
  // Section/page titles.
  title: { fontSize: 26, lineHeight: 32, letterSpacing: 0.2, fontWeight: '700' },
  // Card and row headings.
  heading: { fontSize: 19, lineHeight: 25, letterSpacing: 0.1, fontWeight: '600' },
  // Sub-grouping inside a card.
  subheading: { fontSize: 16, lineHeight: 22, letterSpacing: 0.1, fontWeight: '600' },
  // Default body copy.
  body: { fontSize: 16, lineHeight: 23, letterSpacing: 0, fontWeight: '400' },
  // Secondary body copy.
  callout: { fontSize: 15, lineHeight: 20, letterSpacing: 0, fontWeight: '400' },
  // Supporting metadata.
  caption: { fontSize: 13, lineHeight: 17, letterSpacing: 0.05, fontWeight: '400' },
  // Dense labels and tab bar text.
  micro: { fontSize: 11, lineHeight: 14, letterSpacing: 0.4, fontWeight: '600' },
};

/** Uppercase, wide-tracked label used for section eyebrows. */
export const eyebrow: TypeStyle = {
  fontSize: 12,
  lineHeight: 16,
  letterSpacing: 0.8,
  fontWeight: '700',
};

/**
 * Tabular figures for numeric readouts so digits do not jitter as values change.
 * Available on both iOS (via font-variant-numeric) and Android.
 */
export const numericStyle: TextStyle = {
  fontVariant: ['tabular-nums'],
};
