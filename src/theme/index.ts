import type { Palette } from './colors';
import { lightPalette, darkPalette } from './colors';
import type { SpacingKey, RadiusKey } from './metrics';
import { spacing, radii } from './metrics';
import { typography } from './typography';
import { motion } from './motion';

export interface Theme {
  colors: Palette;
  spacing: typeof import('./metrics').spacing;
  radii: typeof import('./metrics').radii;
  typography: typeof import('./typography').typography;
  motion: typeof import('./motion').motion;
  /** True when the resolved scheme is dark. Components branch on this, not on `Platform`. */
  isDark: boolean;
}

export type { SpacingKey, RadiusKey };

export { lightPalette, darkPalette, seriesColor, seriesColors } from './colors';
export { spacing, radii, HIT_SLOP, MIN_TOUCH_TARGET, layout } from './metrics';
export { typography, eyebrow, numericStyle, MAX_FONT_SCALE } from './typography';
export { motion, easing } from './motion';

export function buildTheme(isDark: boolean): Theme {
  return {
    colors: isDark ? darkPalette : lightPalette,
    spacing,
    radii,
    typography,
    motion,
    isDark,
  };
}
