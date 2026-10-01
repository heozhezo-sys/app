import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme/ThemeProvider';
import { MIN_TOUCH_TARGET } from '@/theme/metrics';
import { seriesColor } from '@/theme/colors';
import { formatDate } from '@/utils/dates';
import type { GoalSummary } from '@/types/goals';

export interface GoalRowProps {
  goal: GoalSummary;
  onPress: () => void;
}

const STATUS_LABELS: Record<GoalSummary['status'], string> = {
  active: 'Active',
  paused: 'Paused',
  completed: 'Done',
  cancelled: 'Cancelled',
  archived: 'Archived',
};

/**
 * One goal with its progress.
 *
 * Accessibility:
 *  - The whole row is one button target with a combined label, so a screen reader
 *    announces the title, state and progress together rather than as fragments.
 *  - Progress is conveyed by a text value ("2 of 3") and a bar, not by colour.
 */
export function GoalRow({ goal, onPress }: GoalRowProps): React.ReactElement {
  const theme = useTheme();
  const accent = seriesColor(goal.colorIndex);
  const done = goal.status === 'completed';

  const parts: string[] = [STATUS_LABELS[goal.status]];
  if (goal.totalMilestones > 0) {
    parts.push(`${goal.completedMilestones} of ${goal.totalMilestones} milestones`);
  }
  if (goal.totalTasks > 0) {
    parts.push(`${goal.completedTasks} of ${goal.totalTasks} tasks`);
  }
  if (goal.targetDate) parts.push(`by ${formatDate(goal.targetDate)}`);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={goal.title}
      accessibilityHint={`${parts.join(', ')}. Double tap to open.`}
      onPress={onPress}
      testID={`goal-${goal.id}`}
      style={({ pressed }) => [
        styles.container,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.lg,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.header}>
        <View
          style={[styles.dot, { backgroundColor: accent }]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View style={{ flex: 1 }}>
          <AppText variant="subheading" style={done ? styles.strikeThrough : undefined}>
            {goal.title}
          </AppText>
          <AppText variant="caption" tone="muted" numberOfLines={2}>
            {parts.join(' · ')}
          </AppText>
        </View>
        <AppText variant="caption" tone="muted" numeric>
          {goal.progressPct}%
        </AppText>
      </View>

      <View style={styles.track}>
        <View
          style={[styles.trackFill, { backgroundColor: accent, width: `${goal.progressPct}%` }]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
    minHeight: MIN_TOUCH_TARGET,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  trackFill: { height: '100%' },
  strikeThrough: { textDecorationLine: 'line-through' },
});
