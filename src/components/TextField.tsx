import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from './AppText';
import { Spacer } from './Button';
import { useTheme } from '@/theme/ThemeProvider';
import { MIN_TOUCH_TARGET } from '@/theme/metrics';
import { MAX_FONT_SCALE } from '@/theme/typography';

export interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string | undefined;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad' | 'numbers-and-punctuation' | 'email-address';
  autoFocus?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  testID?: string;
}

/**
 * Labelled text input with inline validation messaging.
 *
 * Accessibility:
 *  - The label is the accessibility label, so the field is self-describing.
 *  - An error is both visually shown and passed as the accessibility hint, and is
 *    announced through a polite live region.
 *  - Font scaling is honoured and capped so the field never overflows.
 */
export function TextField({
  label,
  value,
  onChangeText,
  error,
  placeholder,
  multiline = false,
  keyboardType = 'default',
  autoFocus = false,
  autoCapitalize = 'sentences',
  testID,
}: TextFieldProps): React.ReactElement {
  const theme = useTheme();

  return (
    <View>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <Spacer size="xs" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textFaint}
        multiline={multiline}
        autoFocus={autoFocus}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        allowFontScaling
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        accessibilityLabel={label}
        accessibilityHint={error}
        testID={testID}
        style={[
          styles.input,
          theme.typography.body,
          {
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
            borderColor: error ? theme.colors.danger : theme.colors.border,
            borderRadius: theme.radii.md,
            minHeight: multiline ? 88 : MIN_TOUCH_TARGET,
            padding: theme.spacing.md,
          },
        ]}
      />
      {error ? (
        <>
          <Spacer size="xs" />
          <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
            {error}
          </AppText>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    textAlignVertical: 'top',
  },
});
