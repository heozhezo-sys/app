import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Button } from './Button';
import { useTheme } from '@/theme/ThemeProvider';
import { MIN_TOUCH_TARGET } from '@/theme/metrics';
import type { SpacingKey } from '@/theme/metrics';

export interface ScreenProps {
  children: React.ReactNode;
  /** Wraps content in a vertical scroll view. Off for FlatList-based screens. */
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Screen shell.
 *
 * Applies the background colour, horizontal padding and safe-area insets once, so
 * no individual screen re-implements them (and forgets the bottom inset).
 */
export function Screen({
  children,
  scroll = true,
  padded = true,
  style,
  testID,
}: ScreenProps): React.ReactElement {
  const theme = useTheme();

  const content = (
    <View
      style={[
        padded && { paddingHorizontal: theme.spacing.lg },
        padded && { paddingBottom: theme.spacing.huge },
        style,
      ]}
    >
      {children}
    </View>
  );

  return (
    <View
      testID={testID}
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
    >
      {scroll ? <View style={styles.flex}>{content}</View> : content}
    </View>
  );
}

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Removes the default inner padding for edge-to-edge list content. */
  flush?: boolean;
}

/**
 * A restrained surface.
 *
 * The specification forbids "excessive rounded cards", so this uses a small radius
 * and a hairline border rather than a heavy shadow.
 */
export function Card({ children, style, flush = false }: CardProps): React.ReactElement {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radii.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          padding: flush ? 0 : theme.spacing.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface SectionProps {
  title: string;
  /** Optional trailing action, e.g. "See all". */
  action?: { label: string; onPress: () => void };
  children?: React.ReactNode;
  spacing?: SpacingKey;
}

export function Section({ title, action, children, spacing = 'lg' }: SectionProps): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: theme.spacing[spacing] }}>
      <View style={styles.sectionHeader}>
        <AppText eyebrow tone="muted" accessibilityRole="header">
          {title.toUpperCase()}
        </AppText>
        {action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            hitSlop={12}
          >
            <AppText variant="caption" tone="accent" weight="600">
              {action.label}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      {children ? <View style={{ marginTop: theme.spacing.sm }}>{children}</View> : null}
    </View>
  );
}

export type ResourceVisualState = 'loading' | 'empty' | 'error' | 'ready';

/**
 * Every screen must handle loading, empty, error and success. This component makes
 * that impossible to forget and keeps the wording consistent.
 *
 * Errors are never swallowed: the message is shown to the user and a retry action is
 * offered rather than an endless spinner.
 */
export function StateView({
  state,
  title,
  emptyTitle = 'Nothing here yet',
  emptyBody,
  loadingLabel = 'Loading',
  errorMessage,
  onRetry,
  compact = false,
}: {
  state: ResourceVisualState;
  title?: string;
  emptyTitle?: string;
  emptyBody?: string;
  loadingLabel?: string;
  errorMessage?: string | null;
  onRetry?: () => void;
  compact?: boolean;
}): React.ReactElement | null {
  const theme = useTheme();

  if (state === 'loading') {
    return (
      <View style={styles.centered} accessibilityRole="progressbar" accessibilityLabel={loadingLabel}>
        <ActivityIndicator color={theme.colors.accent} />
        <View style={{ height: theme.spacing.sm }} />
        <AppText variant="caption" tone="muted">
          {loadingLabel}
        </AppText>
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={styles.centered} accessibilityLiveRegion="polite">
        <AppText variant="subheading" align="center">
          {title ?? 'Something went wrong'}
        </AppText>
        <View style={{ height: theme.spacing.xs }} />
        <AppText variant="caption" tone="muted" align="center">
          {errorMessage ?? 'Your data is safe. Try again.'}
        </AppText>
        {onRetry ? (
          <View style={{ height: theme.spacing.lg }} />
        ) : null}
        {onRetry ? <Button label="Try again" onPress={onRetry} variant="secondary" /> : null}
      </View>
    );
  }

  if (state === 'empty') {
    return (
      <View style={[styles.centered, compact && { paddingVertical: theme.spacing.md }]}>
        <AppText variant="subheading" align="center">
          {emptyTitle}
        </AppText>
        {emptyBody ? (
          <>
            <View style={{ height: theme.spacing.xs }} />
            <AppText variant="caption" tone="muted" align="center">
              {emptyBody}
            </AppText>
          </>
        ) : null}
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 24,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
});

export { MIN_TOUCH_TARGET };
