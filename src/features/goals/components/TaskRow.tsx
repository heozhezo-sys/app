import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme/ThemeProvider';
import { MIN_TOUCH_TARGET } from '@/theme/metrics';
import { formatDate } from '@/utils/dates';
import type { Task } from '@/types/goals';

export interface TaskRowProps {
  task: Task;
  onToggle: () => void;
  onPress?: () => void;
  /** Reference day, used to mark tasks that slipped from an earlier day. */
  todayKey?: string;
  disabled?: boolean;
}

const PRIORITY_LABELS: Record<Task['priority'], string> = {
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority',
};

/**
 * One task with a completion control.
 *
 * Accessibility:
 *  - `checkbox` role with the title as the label and the overdue state in the hint.
 *  - Overdue is shown with the word "Overdue" and a warning colour, never colour alone.
 */
export function TaskRow({
  task,
  onToggle,
  onPress,
  todayKey,
  disabled = false,
}: TaskRowProps): React.ReactElement {
  const theme = useTheme();
  const done = task.status === 'done';
  const overdue = !done && task.plannedDate !== null && todayKey !== undefined && task.plannedDate < todayKey;

  return (
    <View style={[styles.row, { borderColor: theme.colors.border }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done, disabled }}
        accessibilityLabel={task.title}
        accessibilityHint={
          done
            ? 'Done. Double tap to reopen.'
            : overdue
              ? `${PRIORITY_LABELS[task.priority]}. Overdue. Double tap to mark done.`
              : `${PRIORITY_LABELS[task.priority]}. Double tap to mark done.`
        }
        disabled={disabled}
        onPress={onToggle}
        hitSlop={4}
        testID={`task-toggle-${task.id}`}
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
            <AppText variant="micro" tone="onAccent" testID={`task-check-${task.id}`}>
              OK
            </AppText>
          ) : null}
        </View>
      </Pressable>

      <Pressable
        accessibilityRole={onPress ? 'button' : 'text'}
        accessibilityLabel={`${task.title}${overdue ? ', overdue' : ''}`}
        onPress={onPress}
        disabled={!onPress}
        style={styles.text}
      >
        <AppText
          variant="callout"
          tone={done ? 'muted' : 'default'}
          style={done ? styles.strikeThrough : undefined}
          numberOfLines={2}
        >
          {task.title}
        </AppText>
        <View style={styles.metaRow}>
          {overdue ? (
            <AppText variant="micro" tone="warning">
              Overdue
            </AppText>
          ) : null}
          {task.plannedDate && !overdue ? (
            <AppText variant="micro" tone="faint">
              {formatDate(task.plannedDate)}
            </AppText>
          ) : null}
          {task.priority !== 'medium' ? (
            <AppText variant="micro" tone={task.priority === 'high' ? 'warning' : 'faint'}>
              {PRIORITY_LABELS[task.priority]}
            </AppText>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
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
