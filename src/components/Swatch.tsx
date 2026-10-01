import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { MIN_TOUCH_TARGET } from '@/theme/metrics';

export interface SwatchProps {
  color: string;
  selected: boolean;
  onPress: () => void;
  /** Spoken label, e.g. "Colour 3". */
  label: string;
}

/**
 * Colour picker entry.
 *
 * Selection is shown with a border ring AND exposed as `radio`/`selected`, so it is
 * never communicated by colour alone.
 */
export function Swatch({ color, selected, onPress, label }: SwatchProps): React.ReactElement {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      testID={`swatch-${label}`}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: color,
          borderColor: selected ? theme.colors.text : 'transparent',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    width: MIN_TOUCH_TARGET - 8,
    height: MIN_TOUCH_TARGET - 8,
    borderRadius: (MIN_TOUCH_TARGET - 8) / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
