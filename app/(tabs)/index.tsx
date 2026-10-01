import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, Section, StateView } from '@/components/Layout';
import { HabitRow } from '@/features/habits/components/HabitRow';
import { TaskRow } from '@/features/goals/components/TaskRow';
import { HabitEditor } from '@/features/habits/components/HabitEditor';
import { useHabitsForDate, useCreateHabit } from '@/features/habits/hooks/useHabits';
import { useTasksForDay, useToggleTask } from '@/features/goals/hooks/useGoals';
import { useTheme } from '@/theme/ThemeProvider';
import { seriesColor } from '@/theme/colors';
import { formatDate, todayKey } from '@/utils/dates';
import type { HabitWithTodayState } from '@/types/habits';

/**
 * Today — the primary command centre.
 *
 * Shows only what needs doing now: today's habits with their state, and honest
 * progress. Metrics are deliberately absent; the specification asks for calm, not
 * for a wall of charts.
 *
 * The hub at the bottom is the one exception, because it is navigation rather than
 * content: it is how the secondary modules are reached at all.
 */

/**
 * Every implemented destination outside the tab bar.
 *
 * Kept as one list so it cannot drift from the routes actually registered in
 * `app/_layout.tsx`. Adding a screen without adding it here would leave it reachable
 * only by typing a path.
 */
const HUB_LINKS: { label: string; href: string; description: string; testID: string }[] = [
  {
    label: 'Recovery',
    href: '/recovery',
    description: 'Daily ratings and mobility sessions',
    testID: 'recovery',
  },
  {
    label: 'Analytics',
    href: '/analytics',
    description: 'Totals and trends over a day, week, month or year',
    testID: 'analytics',
  },
  {
    label: 'Calendar',
    href: '/calendar',
    description: 'Everything you have recorded, by day',
    testID: 'calendar',
  },
  {
    label: 'Achievements',
    href: '/achievements',
    description: 'Milestones counted from your own records',
    testID: 'achievements',
  },
  {
    label: 'Settings',
    href: '/settings',
    description: 'Units, currency, reminders, privacy and backups',
    testID: 'settings',
  },
];
export default function TodayScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const habits = useHabitsForDate();
  const tasks = useTasksForDay();
  const toggleTask = useToggleTask();
  const createHabit = useCreateHabit();
  const [editing, setEditing] = useState(false);

  const today = todayKey();

  const onCreated = useCallback(async () => {
    setEditing(false);
  }, []);

  const allDone = habits.totalCount > 0 && habits.completedCount === habits.totalCount;

  return (
    <Screen padded={false} scroll>
      <View style={{ paddingTop: insets.top + theme.spacing.sm, paddingBottom: theme.spacing.xxl }}>
        <View style={styles.header}>
          <AppText variant="display" accessibilityRole="header">
            Today
          </AppText>
          <AppText variant="subheading" tone="muted">
            {formatDate(today)}
          </AppText>
        </View>

        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          {allDone ? (
            <Card style={{ marginBottom: theme.spacing.lg }}>
              <AppText variant="subheading">All done for today</AppText>
              <Spacer size="xs" />
              <AppText variant="caption" tone="muted">
                Every habit scheduled for today is complete.
              </AppText>
            </Card>
          ) : null}

          <Section
            title="Habits"
            action={habits.totalCount > 0 ? { label: 'Add', onPress: () => setEditing(true) } : undefined}
          >
            <HabitList
              state={habits.status}
              error={habits.error?.message ?? null}
              onRetry={() => void habits.refresh()}
              items={habits.data ?? []}
              onToggle={(id) => void habits.toggle.run(id)}
              pendingId={null}
            />
          </Section>

          <Section title="Tasks">
            {tasks.status === 'loading' ? (
              <StateView state="loading" loadingLabel="Loading tasks" compact />
            ) : (tasks.data ?? []).length === 0 ? (
              <Card>
                <AppText variant="callout" tone="muted">
                  Nothing planned. Add a task from a goal when you are ready.
                </AppText>
              </Card>
            ) : (
              <Card flush>
                {(tasks.data ?? []).slice(0, 5).map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    todayKey={today}
                    onToggle={() => void toggleTask.run(task.id)}
                    disabled={toggleTask.pending}
                  />
                ))}
              </Card>
            )}
          </Section>

          <Section title="Keep going">
            <Card>
              <AppText variant="callout" tone="muted">
                {habits.totalCount === 0
                  ? 'Add your first habit to start tracking.'
                  : `${habits.completedCount} of ${habits.totalCount} complete`}
              </AppText>
              <Spacer size="md" />
              <View style={styles.track}>
                <View
                  style={{
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: theme.colors.surfaceAlt,
                    flex: 1,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      height: '100%',
                      width: `${habits.totalCount === 0 ? 0 : (habits.completedCount / habits.totalCount) * 100}%`,
                      backgroundColor: seriesColor(0),
                    }}
                  />
                </View>
              </View>
            </Card>
          </Section>

          <Spacer size="xl" />
          <Button label="New habit" onPress={() => setEditing(true)} variant="secondary" fullWidth />

          {/*
            The secondary-module hub.

            `UI_UX/NAVIGATION.md` names five primary tabs and asks that everything else be
            reached "through Today, feature hubs and Settings". This is that hub: one
            place listing every implemented destination outside the tab bar, so nothing
            is reachable only by luck of the tab order. ADR-0010 already requires that a
            destination only appears once it is implemented.
          */}
          <Section title="Everything else">
            <Card flush>
              {HUB_LINKS.map((link, index) => (
                <View key={link.href}>
                  {index > 0 && <View style={styles.divider} />}
                  <Button
                    label={link.label}
                    accessibilityLabel={`${link.label}. ${link.description}`}
                    accessibilityHint={link.description}
                    onPress={() => router.push(link.href as never)}
                    variant="ghost"
                    fullWidth
                    style={styles.hubRow}
                    testID={`today-hub-${link.testID}`}
                  />
                </View>
              ))}
            </Card>
          </Section>
        </View>
      </View>

      <HabitEditor
        visible={editing}
        onClose={() => setEditing(false)}
        onSubmit={async (input) => {
          const created = await createHabit.run(input);
          if (created) await onCreated();
          return created;
        }}
        pending={createHabit.pending}
        error={createHabit.error?.message ?? null}
      />
    </Screen>
  );
}

function HabitList({
  state,
  error,
  onRetry,
  items,
  onToggle,
  pendingId,
}: {
  state: 'loading' | 'ready' | 'error';
  error: string | null;
  onRetry: () => void;
  items: HabitWithTodayState[];
  onToggle: (id: string) => void;
  pendingId: string | null;
}): React.ReactElement {
  if (state === 'loading') {
    return <StateView state="loading" loadingLabel="Loading today's habits" />;
  }
  if (state === 'error' && items.length === 0) {
    return (
      <StateView
        state="error"
        errorMessage={error}
        onRetry={onRetry}
      />
    );
  }
  if (items.length === 0) {
    return (
      <StateView
        state="empty"
        emptyTitle="No habits scheduled today"
        emptyBody="Create a habit and it will appear here every day you are due to do it."
        compact
      />
    );
  }

  return (
    <View style={styles.list}>
      {items.map((habit) => (
        <HabitRow
          key={habit.id}
          habit={habit}
          onToggle={() => onToggle(habit.id)}
          disabled={pendingId === habit.id}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  list: { gap: 8 },
  track: { flexDirection: 'row' },
  hubRow: { justifyContent: 'flex-start', paddingHorizontal: 16 },
  divider: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.2,
    marginHorizontal: 16,
  },
});
