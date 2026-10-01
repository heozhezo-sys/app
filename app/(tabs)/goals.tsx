import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, Section, StateView } from '@/components/Layout';
import { GoalRow } from '@/features/goals/components/GoalRow';
import { GoalEditor } from '@/features/goals/components/GoalEditor';
import { useCreateGoal, useGoals } from '@/features/goals/hooks/useGoals';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Goals overview.
 *
 * Shows every goal that is not archived, with derived progress. Completed and
 * cancelled goals stay visible because hiding a finished goal is how people lose track
 * of what they achieved.
 */
export default function GoalsScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const goals = useGoals();
  const createGoal = useCreateGoal();
  const [creating, setCreating] = useState(false);

  const all = goals.data ?? [];
  const open = all.filter((g) => g.status === 'active' || g.status === 'paused');
  const closed = all.filter((g) => g.status === 'completed' || g.status === 'cancelled');

  return (
    <>
      <Screen padded={false}>
        <View style={{ paddingTop: insets.top + theme.spacing.sm, paddingHorizontal: theme.spacing.lg }}>
          <AppText variant="display" accessibilityRole="header">
            Goals
          </AppText>
          <AppText variant="subheading" tone="muted">
            {all.length === 0
              ? 'Nothing set up yet'
              : `${open.length} open${closed.length > 0 ? `, ${closed.length} finished` : ''}`}
          </AppText>

          <Spacer size="lg" />

          {goals.status === 'loading' ? (
            <StateView state="loading" loadingLabel="Loading goals" />
          ) : goals.status === 'error' && all.length === 0 ? (
            <StateView
              state="error"
              errorMessage={goals.error?.message}
              onRetry={() => void goals.refresh()}
            />
          ) : all.length === 0 ? (
            <Card>
              <AppText variant="subheading">Name the next thing you want</AppText>
              <Spacer size="xs" />
              <AppText variant="caption" tone="muted">
                A goal becomes useful once it has milestones. Break it into steps you
                could finish this month.
              </AppText>
            </Card>
          ) : (
            <>
              {open.length > 0 ? (
                <Section title="Open">
                  <View style={{ gap: theme.spacing.sm }}>
                    {open.map((goal) => (
                      <GoalRow
                        key={goal.id}
                        goal={goal}
                        onPress={() => router.push(`/goal/${goal.id}`)}
                      />
                    ))}
                  </View>
                </Section>
              ) : null}

              {closed.length > 0 ? (
                <Section title="Finished">
                  <View style={{ gap: theme.spacing.sm }}>
                    {closed.map((goal) => (
                      <GoalRow
                        key={goal.id}
                        goal={goal}
                        onPress={() => router.push(`/goal/${goal.id}`)}
                      />
                    ))}
                  </View>
                </Section>
              ) : null}
            </>
          )}

          <Spacer size="xl" />
          <Button label="New goal" onPress={() => setCreating(true)} fullWidth />
        </View>
      </Screen>

      <GoalEditor
        visible={creating}
        onClose={() => setCreating(false)}
        onSubmit={async (input) => {
          const result = await createGoal.run(input);
          if (result) setCreating(false);
          return result;
        }}
        pending={createGoal.pending}
        error={createGoal.error?.message ?? null}
      />
    </>
  );
}
