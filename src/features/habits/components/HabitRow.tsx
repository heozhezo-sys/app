import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme/ThemeProvider';
import { MIN_TOUCH_TARGET } from '@/theme/metrics';
import { seriesColor } from '@/theme/colors';
import type { HabitWithTodayState } from '@/types/habits';

export interface HabitRowProps {
  habit: HabitWithTodayState;
  onToggle: () => void;
  disabled?: boolean;
}

/**
 * One habit with its completion control.
 *
 * Accessibility:
 *  - The whole row is a single `checkbox` role target, so VoiceOver/TalkBack
 *    announce "Done / Not done" together with the title.
 *  - State is carried by a check glyph AND a strikethrough AND the accessibility
 *    state, never by colour alone.
 *  - 48pt minimum touch target.
 */
export function HabitRow({ habit, onToggle, disabled = false }: HabitRowProps): React.ReactElement {
  const theme = useTheme();
  const accent = seriesColor(habit.colorIndex);
  const done = habit.completedToday;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.surface,
          borderColor: done ? accent : theme.colors.border,
          borderRadius: theme.radii.lg,
        },
      ]}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done, disabled }}
        accessibilityLabel={habit.title}
        accessibilityHint={done ? 'Completed today. Double tap to undo.' : 'Double tap to mark done.'}
        disabled={disabled}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.pressable,
          { minHeight: MIN_TOUCH_TARGET, opacity: pressed ? 0.7 : 1 },
        ]}
        testID={`habit-toggle-${habit.id}`}
      >
        <View
          style={[
            styles.checkbox,
            {
              borderColor: done ? accent : theme.colors.borderStrong,
              backgroundColor: done ? accent : 'transparent',
              borderRadius: theme.radii.sm,
            },
          ]}
        >
          {done ? (
            <AppText variant="micro" tone="onAccent" testID={`habit-check-${habit.id}`}>
              ✓
            </AppText>
          ) : null}
        </View>

        <View style={styles.text}>
          <AppText
            variant="subheading"
            tone={done ? 'muted' : 'default'}
            style={done ? styles.strikeThrough : undefined}
            numberOfLines={2}
          >
            {habit.title}
          </AppText>
          {habit.description ? (
            <AppText variant="caption" tone="faint" numberOfLines={2}>
              {habit.description}
            </AppText>
          ) : null}
        </View>

        {habit.targetPerPeriod > 1 ? (
          <AppText variant="caption" tone="muted" numeric>
            {habit.completedThisPeriod}/{habit.targetPerPeriod}
          </AppText>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  strikeThrough: { textDecorationLine: 'line-through' },
});
