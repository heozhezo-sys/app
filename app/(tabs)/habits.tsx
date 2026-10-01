import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, StateView } from '@/components/Layout';
import { HabitRow } from '@/features/habits/components/HabitRow';
import { HabitEditor } from '@/features/habits/components/HabitEditor';
import {
  useAllHabits,
  useCreateHabit,
  useHabitsForDate,
} from '@/features/habits/hooks/useHabits';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Habit management.
 *
 * Today shows what is due; this screen is where habits are created, reviewed and
 * retired. Archived habits are kept with their history rather than deleted.
 */
export default function HabitsScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const today = useHabitsForDate();
  const all = useAllHabits();
  const create = useCreateHabit();
  const [creating, setCreating] = useState(false);

  const archived = (all.data ?? []).filter((h) => h.status === 'archived');
  const activeCount = (all.data ?? []).filter((h) => h.status === 'active').length;

  return (
    <>
      <Screen padded={false}>
        <View style={{ paddingTop: insets.top + theme.spacing.sm, paddingHorizontal: theme.spacing.lg }}>
          <AppText variant="display" accessibilityRole="header">
            Habits
          </AppText>
          <AppText variant="subheading" tone="muted">
            {activeCount === 0
              ? 'Nothing set up yet'
              : `${activeCount} active${archived.length > 0 ? `, ${archived.length} archived` : ''}`}
          </AppText>

          <Spacer size="lg" />

          {all.status === 'loading' ? (
            <StateView state="loading" loadingLabel="Loading habits" />
          ) : all.status === 'error' && (all.data ?? []).length === 0 ? (
            <StateView state="error" errorMessage={all.error?.message} onRetry={() => void all.refresh()} />
          ) : (all.data ?? []).filter((h) => h.status === 'active').length === 0 ? (
            <Card>
              <AppText variant="subheading">Start with one habit</AppText>
              <Spacer size="xs" />
              <AppText variant="caption" tone="muted">
                Keep it small enough that you would do it on a bad day. You can always add
                more.
              </AppText>
            </Card>
          ) : (
            <View style={{ gap: theme.spacing.sm }}>
              {(today.data ?? []).map((habit) => (
                <HabitRow
                  key={habit.id}
                  habit={habit}
                  onToggle={() => void today.toggle.run(habit.id)}
                  disabled={today.toggle.pending}
                />
              ))}
            </View>
          )}

          {archived.length > 0 ? (
            <>
              <Spacer size="xl" />
              <AppText variant="caption" tone="muted" accessibilityRole="header">
                ARCHIVED
              </AppText>
              <Spacer size="sm" />
              <View style={{ gap: theme.spacing.sm }}>
                {archived.map((habit) => (
                  <Card key={habit.id}>
                    <AppText variant="subheading" tone="muted">
                      {habit.title}
                    </AppText>
                    <Spacer size="xs" />
                    <AppText variant="caption" tone="faint">
                      History kept. Restore it from the habit screen.
                    </AppText>
                  </Card>
                ))}
              </View>
            </>
          ) : null}

          <Spacer size="xl" />
          <Button label="New habit" onPress={() => setCreating(true)} fullWidth />
          <Spacer size="md" />
          <Button
            label="Manage habits"
            variant="ghost"
            onPress={() => router.push('/manage')}
            fullWidth
          />
        </View>
      </Screen>

      <HabitEditor
        visible={creating}
        onClose={() => setCreating(false)}
        onSubmit={async (input) => {
          const result = await create.run(input);
          if (result) setCreating(false);
          return result;
        }}
        pending={create.pending}
        error={create.error?.message ?? null}
      />
    </>
  );
}
