import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, StateView } from '@/components/Layout';
import {
  useAllHabits,
  useArchiveHabit,
  useDeleteHabit,
  useRestoreHabit,
} from '@/features/habits/hooks/useHabits';
import { useTheme } from '@/theme/ThemeProvider';
import { seriesColor } from '@/theme/colors';
import { formatDate } from '@/utils/dates';

/**
 * Archive, restore and delete.
 *
 * Delete is a soft delete: the record is hidden and its history is retained, because
 * the specification treats user history as sacred. The UI says so plainly rather
 * than implying the data is gone.
 */
export default function ManageHabitsScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const habits = useAllHabits(true);
  const archive = useArchiveHabit();
  const restore = useRestoreHabit();
  const remove = useDeleteHabit();

  const busy = archive.pending || restore.pending || remove.pending;

  return (
    <Screen padded={false}>
      <View style={{ paddingTop: insets.top + theme.spacing.sm, paddingHorizontal: theme.spacing.lg }}>
        <AppText variant="title" accessibilityRole="header">
          Manage habits
        </AppText>
        <Spacer size="xs" />
        <AppText variant="caption" tone="muted">
          Archiving keeps your streak history and hides the habit from Today. Deleting
          hides it and keeps its records on this device.
        </AppText>

        <Spacer size="lg" />

        {habits.status === 'loading' ? (
          <StateView state="loading" loadingLabel="Loading habits" />
        ) : habits.status === 'error' && (habits.data ?? []).length === 0 ? (
          <StateView
            state="error"
            errorMessage={habits.error?.message}
            onRetry={() => void habits.refresh()}
          />
        ) : (habits.data ?? []).length === 0 ? (
          <StateView
            state="empty"
            emptyTitle="No habits yet"
            emptyBody="Create a habit on the Today or Habits tab to get started."
          />
        ) : (
          <View style={{ gap: theme.spacing.md }}>
            {(habits.data ?? []).map((habit) => (
              <Card key={habit.id}>
                <View style={styles.row}>
                  <View
                    style={[styles.dot, { backgroundColor: seriesColor(habit.colorIndex) }]}
                  />
                  <View style={{ flex: 1 }}>
                    <AppText variant="subheading">{habit.title}</AppText>
                    <AppText variant="caption" tone="faint">
                      Created {formatDate(new Date(habit.createdAt).toISOString().slice(0, 10))}
                      {habit.status === 'archived' ? ' · Archived' : ''}
                    </AppText>
                  </View>
                </View>

                <Spacer size="md" />

                <View style={styles.actions}>
                  {habit.status === 'archived' ? (
                    <Button
                      label="Restore"
                      variant="secondary"
                      size="compact"
                      disabled={busy}
                      onPress={() => void restore.run(habit.id)}
                      accessibilityHint={`Bring ${habit.title} back into Today`}
                    />
                  ) : (
                    <Button
                      label="Archive"
                      variant="secondary"
                      size="compact"
                      disabled={busy}
                      onPress={() => void archive.run(habit.id)}
                      accessibilityHint={`Hide ${habit.title} from Today and keep its history`}
                    />
                  )}
                  <Button
                    label="Delete"
                    variant="danger"
                    size="compact"
                    disabled={busy}
                    onPress={() => void remove.run(habit.id)}
                    accessibilityHint={`Hide ${habit.title} permanently from your lists`}
                  />
                </View>
              </Card>
            ))}
          </View>
        )}

        {archive.error || restore.error || remove.error ? (
          <>
            <Spacer size="lg" />
            <Card style={{ borderColor: theme.colors.danger }}>
              <AppText tone="danger" accessibilityLiveRegion="assertive">
                {archive.error?.message ?? restore.error?.message ?? remove.error?.message}
              </AppText>
            </Card>
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = {
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 } as const,
  dot: { width: 12, height: 12, borderRadius: 6 } as const,
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' } as const,
};
