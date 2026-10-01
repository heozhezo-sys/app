import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppText } from './AppText';
import { useTheme } from '@/theme/ThemeProvider';
import { HIT_SLOP, MIN_TOUCH_TARGET } from '@/theme/metrics';
import type { SpacingKey } from '@/theme/metrics';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'regular' | 'compact';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** Announced instead of the label when set; also shown visually if provided. */
  accessibilityHint?: string;
  /** Overrides `label` for assistive tech when the visible label is ambiguous. */
  accessibilityLabel?: string;
  /**
   * Conveys a toggle or selection state to assistive tech.
   *
   * Needed because a button whose state is shown only by its `variant` is a state conveyed
   * by colour alone, which fails the project's accessibility rule. A screen reader needs
   * this to announce "selected" rather than just "Favourites".
   */
  selected?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Primary interactive control.
 *
 * Accessibility:
 *  - `accessibilityRole="button"` and disabled state are exposed to VoiceOver/TalkBack.
 *  - Minimum 48pt tall, which satisfies both the iOS HIG (44pt) and Material (48dp).
 *  - `hitSlop` extends the touch area for compact variants without changing layout.
 *  - Press feedback is opacity, not colour, so it never relies on colour alone.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'regular',
  disabled = false,
  loading = false,
  selected,
  accessibilityHint,
  accessibilityLabel,
  fullWidth = false,
  style,
  testID,
}: ButtonProps): React.ReactElement {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const height = size === 'compact' ? 40 : MIN_TOUCH_TARGET;

  const background =
    variant === 'primary'
      ? theme.colors.accent
      : variant === 'danger'
        ? theme.colors.danger
        : variant === 'secondary'
          ? theme.colors.surfaceAlt
          : 'transparent';

  const labelTone =
    variant === 'primary' || variant === 'danger'
      ? ('onAccent' as const)
      : variant === 'secondary'
        ? ('default' as const)
        : ('accent' as const);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading, ...(selected !== undefined ? { selected } : {}) }}
      disabled={isDisabled}
      onPress={onPress}
      hitSlop={size === 'compact' ? HIT_SLOP : undefined}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: height,
          paddingHorizontal: size === 'compact' ? theme.spacing.lg : theme.spacing.xl,
          borderRadius: theme.radii.md,
          backgroundColor: background,
          borderWidth: variant === 'ghost' ? StyleSheet.hairlineWidth : 0,
          borderColor: theme.colors.border,
          opacity: isDisabled ? 0.45 : pressed ? 0.7 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator
            size="small"
            color={
              variant === 'primary' || variant === 'danger'
                ? theme.colors.onAccent
                : theme.colors.accent
            }
          />
        ) : null}
        <AppText
          variant={size === 'compact' ? 'callout' : 'body'}
          tone={labelTone}
          weight="600"
          numberOfLines={1}
        >
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 0,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});

export type SpacerProps = { size?: SpacingKey; style?: StyleProp<ViewStyle> };

/** Explicit vertical rhythm between sections. */
export function Spacer({ size = 'lg', style }: SpacerProps): React.ReactElement {
  const theme = useTheme();
  return <View style={[{ height: theme.spacing[size] }, style]} />;
}
