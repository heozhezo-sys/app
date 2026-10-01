import React from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { typography, numericStyle, MAX_FONT_SCALE, type TypeScaleKey } from '@/theme/typography';
import type { Palette } from '@/theme/colors';

export type TextTone = 'default' | 'muted' | 'faint' | 'accent' | 'success' | 'warning' | 'danger' | 'onAccent';

export interface AppTextProps extends TextProps {
  variant?: TypeScaleKey;
  tone?: TextTone;
  /** Tabular figures, for values that update in place. */
  numeric?: boolean;
  /** Renders as an all-caps wide-tracked eyebrow. */
  eyebrow?: boolean;
  align?: TextStyle['textAlign'];
  weight?: TextStyle['fontWeight'];
}

const TONE_KEYS: Record<TextTone, keyof Palette> = {
  default: 'text',
  muted: 'textMuted',
  faint: 'textFaint',
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  onAccent: 'onAccent',
};

/**
 * The only text primitive in the app.
 *
 * Accessibility notes:
 *  - `allowFontScaling` stays ON, so Dynamic Type (iOS) and Android font scaling work.
 *  - The multiplier is capped at `MAX_FONT_SCALE`; beyond that, dense layouts break
 *    in ways users cannot fix. Long text wraps rather than truncating by default.
 */
export function AppText({
  variant = 'body',
  tone = 'default',
  numeric = false,
  eyebrow = false,
  align,
  weight,
  style,
  ...rest
}: AppTextProps): React.ReactElement {
  const theme = useTheme();

  const base = eyebrow
    ? { ...typography.caption, fontWeight: '700' as const, letterSpacing: 0.8 }
    : typography[variant];

  return (
    <Text
      allowFontScaling
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={[
        base,
        { color: theme.colors[TONE_KEYS[tone]] },
        numeric ? numericStyle : null,
        align ? { textAlign: align } : null,
        weight ? { fontWeight: weight } : null,
        style,
      ]}
      {...rest}
    />
  );
}
