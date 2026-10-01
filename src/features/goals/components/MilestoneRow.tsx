import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme/ThemeProvider';
import { MIN_TOUCH_TARGET } from '@/theme/metrics';
import { formatDate } from '@/utils/dates';
import type { Milestone } from '@/types/goals';

export interface MilestoneRowProps {
  milestone: Milestone;
  onToggle: () => void;
  disabled?: boolean;
}

/**
 * One milestone with a completion control.
 *
 * Completion is shown as a check glyph, a strike-through and the `checked` state, so
 * it never depends on colour alone.
 */
export function MilestoneRow({ milestone, onToggle, disabled = false }: MilestoneRowProps): React.ReactElement {
  const theme = useTheme();
  const done = milestone.status === 'completed';
  const skipped = milestone.status === 'skipped';

  return (
    <View style={[styles.row, { borderBottomColor: theme.colors.border }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done, disabled }}
        accessibilityLabel={milestone.title}
        accessibilityHint={
          done
            ? 'Completed. Double tap to reopen.'
            : skipped
              ? 'Skipped. Double tap to complete.'
              : 'Double tap to mark complete.'
        }
        disabled={disabled}
        onPress={onToggle}
        hitSlop={4}
        testID={`milestone-toggle-${milestone.id}`}
        style={({ pressed }) => [styles.check, { opacity: pressed ? 0.7 : 1 }]}
      >
        <View
          style={[
            styles.box,
            {
              borderColor: done ? theme.colors.success : theme.colors.borderStrong,
              backgroundColor: done ? theme.colors.success : 'transparent',
              borderRadius: theme.radii.sm,
            },
          ]}
        >
          {done ? (
            <AppText variant="micro" tone="onAccent" testID={`milestone-check-${milestone.id}`}>
              OK
            </AppText>
          ) : null}
        </View>
      </Pressable>

      <View style={styles.text}>
        <AppText
          variant="callout"
          tone={done || skipped ? 'muted' : 'default'}
          style={done || skipped ? styles.strikeThrough : undefined}
          numberOfLines={2}
        >
          {milestone.title}
        </AppText>
        <View style={styles.metaRow}>
          {milestone.dueDate ? (
            <AppText variant="micro" tone="faint">
              Due {formatDate(milestone.dueDate)}
            </AppText>
          ) : null}
          {skipped ? (
            <AppText variant="micro" tone="faint">
              Skipped
            </AppText>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: MIN_TOUCH_TARGET,
  },
  check: { paddingTop: 2 },
  box: {
    width: 26,
    height: 26,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  metaRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  strikeThrough: { textDecorationLine: 'line-through' },
});
