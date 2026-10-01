import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, Section, StateView } from '@/components/Layout';
import { TextField } from '@/components/TextField';
import { TaskRow } from '@/features/goals/components/TaskRow';
import { MilestoneRow } from '@/features/goals/components/MilestoneRow';
import {
  useCreateMilestone,
  useCreateTask,
  useGoalDetail,
  useSetGoalStatus,
  useSetMilestoneStatus,
  useToggleTask,
} from '@/features/goals/hooks/useGoals';
import { useTheme } from '@/theme/ThemeProvider';
import { seriesColor } from '@/theme/colors';
import { todayKey } from '@/utils/dates';
import { GOAL_TRANSITIONS } from '@/services/stateTransitions';
import type { GoalStatus } from '@/types/goals';

const STATUS_LABELS: Record<GoalStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
  archived: 'Archived',
};

/**
 * Goal detail: milestones, tasks and lifecycle controls.
 *
 * Only transitions the state machine allows are offered as buttons, so the UI cannot
 * offer an action the domain layer would reject.
 */
export default function GoalDetailScreen(): React.ReactElement {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const goalId = typeof params.id === 'string' ? params.id : '';

  const detail = useGoalDetail(goalId);
  const setStatus = useSetGoalStatus();
  const setMilestoneStatus = useSetMilestoneStatus();
  const createMilestone = useCreateMilestone();
  const createTask = useCreateTask();
  const toggleTask = useToggleTask();

  const [newMilestone, setNewMilestone] = useState('');
  const [newTask, setNewTask] = useState('');

  const goal = detail.data?.goal ?? null;
  const milestones = detail.data?.milestones ?? [];
  const tasks = detail.data?.tasks ?? [];
  const accent = seriesColor(goal?.colorIndex ?? 0);

  if (detail.status === 'loading') {
    return (
      <Screen>
        <StateView state="loading" loadingLabel="Loading goal" />
      </Screen>
    );
  }

  if (detail.status === 'error' || !goal) {
    return (
      <Screen>
        <StateView
          state="error"
          title="Goal not available"
          errorMessage={detail.error?.message ?? 'This goal may have been deleted.'}
          onRetry={() => void detail.refresh()}
        />
      </Screen>
    );
  }

  const nextStatuses = GOAL_TRANSITIONS[goal.status].filter((s) => s !== 'archived');

  return (
    <Screen>
      <AppText variant="title" accessibilityRole="header">
        {goal.title}
      </AppText>
      {goal.description ? (
        <>
          <Spacer size="xs" />
          <AppText tone="muted">{goal.description}</AppText>
        </>
      ) : null}

      <Spacer size="lg" />

      <Card>
        <View style={styles.progressRow}>
          <AppText variant="display" numeric>
            {goal.progressPct}%
          </AppText>
          <AppText variant="caption" tone="muted" style={styles.progressLabel}>
            {STATUS_LABELS[goal.status]}
          </AppText>
        </View>
        <Spacer size="sm" />
        <View style={[styles.track, { backgroundColor: theme.colors.surfaceAlt }]}>
          <View style={[styles.fill, { backgroundColor: accent, width: `${goal.progressPct}%` }]} />
        </View>
      </Card>

      {nextStatuses.length > 0 ? (
        <>
          <Spacer size="md" />
          <View style={styles.actions}>
            {nextStatuses.map((status) => (
              <Button
                key={status}
                label={STATUS_LABELS[status]}
                size="compact"
                variant={status === 'cancelled' ? 'danger' : 'secondary'}
                disabled={setStatus.pending}
                onPress={() => void setStatus.run(goal.id, status)}
                accessibilityHint={`Mark this goal ${STATUS_LABELS[status].toLowerCase()}`}
              />
            ))}
          </View>
          {setStatus.error ? (
            <>
              <Spacer size="sm" />
              <AppText variant="caption" tone="danger" accessibilityLiveRegion="assertive">
                {setStatus.error.message}
              </AppText>
            </>
          ) : null}
        </>
      ) : null}

      <Spacer size="xl" />

      <Section title="Milestones">
        {milestones.length === 0 ? (
          <Card>
            <AppText variant="callout" tone="muted">
              No milestones yet. Progress is calculated from them, so adding one makes
              this goal easier to keep moving.
            </AppText>
          </Card>
        ) : (
          <Card flush>
            {milestones.map((milestone) => (
              <MilestoneRow
                key={milestone.id}
                milestone={milestone}
                onToggle={() => {
                  const next = milestone.status === 'completed' ? 'pending' : 'completed';
                  void setMilestoneStatus.run(milestone.id, next);
                }}
                disabled={setMilestoneStatus.pending}
              />
            ))}
          </Card>
        )}

        <Spacer size="sm" />
        <TextField
          label="Add a milestone"
          value={newMilestone}
          onChangeText={setNewMilestone}
          placeholder="Buy running shoes"
          testID="milestone-title"
        />
        <Spacer size="sm" />
        <Button
          label="Add milestone"
          variant="secondary"
          disabled={newMilestone.trim() === '' || createMilestone.pending}
          onPress={() => {
            const title = newMilestone.trim();
            if (title === '') return;
            void createMilestone.run(goal.id, title).then((created) => {
              if (created) setNewMilestone('');
            });
          }}
          testID="milestone-submit"
        />
      </Section>

      <Spacer size="lg" />

      <Section title="Tasks">
        {tasks.length === 0 ? (
          <AppText variant="callout" tone="muted">
            No tasks yet.
          </AppText>
        ) : (
          <Card flush>
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                todayKey={todayKey()}
                onToggle={() => void toggleTask.run(task.id)}
                disabled={toggleTask.pending}
              />
            ))}
          </Card>
        )}

        <Spacer size="sm" />
        <TextField
          label="Add a task"
          value={newTask}
          onChangeText={setNewTask}
          placeholder="Block out two training runs"
          testID="task-title"
        />
        <Spacer size="sm" />
        <Button
          label="Add task"
          variant="secondary"
          disabled={newTask.trim() === '' || createTask.pending}
          onPress={() => {
            const title = newTask.trim();
            if (title === '') return;
            void createTask.run({ title, goalId: goal.id }).then((created) => {
              if (created) setNewTask('');
            });
          }}
          testID="task-submit"
        />
      </Section>

      {createTask.error || createMilestone.error ? (
        <>
          <Spacer size="lg" />
          <AppText variant="caption" tone="danger" accessibilityLiveRegion="assertive">
            {createTask.error?.message ?? createMilestone.error?.message}
          </AppText>
        </>
      ) : null}
    </Screen>
  );
}

const styles = {
  progressRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12 } as const,
  progressLabel: { flex: 1 } as const,
  track: { height: 8, borderRadius: 4, overflow: 'hidden' } as const,
  fill: { height: '100%' } as const,
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' } as const,
};
