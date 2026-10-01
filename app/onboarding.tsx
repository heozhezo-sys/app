import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen } from '@/components/Layout';
import { useTheme } from '@/theme/ThemeProvider';
import { useSettingsStore } from '@/stores/settingsStore';
import type { AppearancePreference } from '@/types/settings';

const APPEARANCES: { value: AppearancePreference; title: string; body: string }[] = [
  { value: 'system', title: 'Match system', body: 'Follows your phone appearance.' },
  { value: 'light', title: 'Light', body: 'Always the light theme.' },
  { value: 'dark', title: 'Dark', body: 'Always the dark theme.' },
];

/**
 * First-run onboarding.
 *
 * Deliberately short. There is no sign-up and no account: the app is local-first, and
 * asking for an identity before the user has seen any value would be dishonest about
 * how the product works.
 */
export default function OnboardingScreen(): React.ReactElement {
  const theme = useTheme();
  const router = useRouter();
  const update = useSettingsStore((state) => state.update);
  const [appearance, setAppearance] = useState<AppearancePreference>('system');
  const [dailyGoal, setDailyGoal] = useState(3);
  const [saving, setSaving] = useState(false);

  const finish = async (): Promise<void> => {
    setSaving(true);
    try {
      await update({ appearance, dailyHabitGoal: dailyGoal, onboardingCompleted: true });
      router.replace('/today');
    } catch {
      // The gate will send the user back here on the next launch; do not navigate
      // to a screen whose precondition failed.
      setSaving(false);
    }
  };

  return (
    <Screen>
      <View style={{ paddingTop: theme.spacing.xxxl }}>
        <AppText variant="display" accessibilityRole="header">
          Welcome to LifeOS
        </AppText>
        <Spacer size="sm" />
        <AppText tone="muted">
          One calm place for habits, health, reading and money. Everything stays on this
          device and works without an account or an internet connection.
        </AppText>
      </View>

      <Spacer size="xxl" />

      <AppText variant="caption" tone="muted">
        Appearance
      </AppText>
      <Spacer size="sm" />
      <View style={{ gap: theme.spacing.sm }}>
        {APPEARANCES.map((option) => {
          const selected = appearance === option.value;
          return (
            <Card key={option.value} style={{ borderColor: selected ? theme.colors.accent : theme.colors.border }}>
              <View style={styles.optionRow}>
                <View style={{ flex: 1 }}>
                  <AppText variant="subheading">{option.title}</AppText>
                  <AppText variant="caption" tone="muted">
                    {option.body}
                  </AppText>
                </View>
                <Button
                  label={selected ? 'Selected' : 'Choose'}
                  size="compact"
                  variant={selected ? 'primary' : 'secondary'}
                  onPress={() => setAppearance(option.value)}
                  accessibilityHint={selected ? 'Currently selected.' : `Use ${option.title}.`}
                />
              </View>
            </Card>
          );
        })}
      </View>

      <Spacer size="xl" />

      <AppText variant="caption" tone="muted">
        How many habits a day feels realistic?
      </AppText>
      <Spacer size="sm" />
      <View style={styles.optionRow}>
        {[2, 3, 5, 7].map((count) => {
          const selected = dailyGoal === count;
          return (
            <Button
              key={count}
              label={String(count)}
              variant={selected ? 'primary' : 'secondary'}
              onPress={() => setDailyGoal(count)}
              accessibilityHint={selected ? 'Currently selected.' : `Aim for ${count} habits.`}
            />
          );
        })}
      </View>

      <Spacer size="huge" />
      <Button label="Get started" onPress={() => void finish()} loading={saving} fullWidth />
      <Spacer size="sm" />
      <AppText variant="micro" tone="faint" align="center">
        You can change all of this later in Settings.
      </AppText>
    </Screen>
  );
}

const styles = {
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 } as const,
};
