/**
 * Achievements.
 *
 * `FEATURES/ACHIEVEMENTS.md` asks for milestones derived from real records. Nothing here
 * stores a counter: every figure is read from history when the screen loads, so deleting a
 * workout correctly lowers the number rather than leaving a stale total.
 *
 * Gamification can be switched off. "Off" means no celebration and no confetti — not
 * "your progress is hidden". Switching it back on shows real numbers rather than a blank
 * screen, because the work still happened.
 */

import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, Section, StateView } from '@/components/Layout';
import {
  useAchievementsOverview,
  useEvaluateAchievements,
} from '@/features/achievements/hooks/useAchievements';
import { useUpdateSettings } from '@/features/settings/hooks/useSettingsActions';
import { useSettings } from '@/stores/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * A record's metric key is the storage name, e.g. `exercise.max_weight_g`.
 *
 * Turning it into words is presentation, so it happens here rather than being stored as
 * a second label that could drift from the metric it describes.
 */
function describeRecord(metric: string, scope: string): string {
  const what = scope === 'sport' ? 'Sport' : 'Exercise';
  if (metric.includes('max_weight')) return `Heaviest ${what.toLowerCase()} lifted`;
  if (metric.includes('max_reps')) return `Most reps in one set`;
  if (metric.includes('max_distance')) return `Longest single session`;
  if (metric.includes('max_duration')) return `Longest session`;
  if (metric.includes('total_volume')) return `Most volume in one session`;
  return `Best ${what.toLowerCase()} record`;
}

/** Grams and metres are integers; only derived values need rounding for display. */
function roundForDisplay(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function AchievementsScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const evaluate = useEvaluateAchievements();

  const overview = useAchievementsOverview(!settings.gamificationEnabled);
  const data = overview.data;
  const quiet = !settings.gamificationEnabled;

  const toggle = useCallback(
    async (enabled: boolean) => {
      await updateSettings.run({ gamificationEnabled: enabled });
      await evaluate.run({ announce: enabled });
      await overview.refresh();
    },
    [evaluate, overview, updateSettings],
  );

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xl,
        }}
      >
        <AppText variant="display" accessibilityRole="header">
          Achievements
        </AppText>
        <Spacer size="xs" />
        <AppText variant="caption" tone="muted">
          Milestones counted from your own records. None of them are stored — delete a
          workout and the numbers follow it down.
        </AppText>

        <Spacer size="lg" />

        {overview.status === 'loading' || !data ? (
          <StateView state="loading" loadingLabel="Counting" />
        ) : (
          <>
            <Card>
              <AppText variant="display">
                {data.unlockedCount} of {data.totalCount}
              </AppText>
              <Spacer size="xs" />
              <AppText variant="caption" tone="muted">
                unlocked
              </AppText>
              <Spacer size="md" />
              <View
                style={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: theme.colors.surfaceAlt,
                  overflow: 'hidden',
                }}
                accessibilityRole="progressbar"
                accessibilityLabel={`${data.percent} percent unlocked`}
                accessibilityValue={{ min: 0, max: 100, now: data.percent }}
              >
                <View
                  style={{
                    height: '100%',
                    width: `${data.percent}%`,
                    backgroundColor: theme.colors.accent,
                  }}
                />
              </View>
            </Card>

            {data.records.length > 0 ? (
              <Section title="Personal records">
                <Card flush>
                  {data.records.map((record, index) => (
                    <View key={record.id}>
                      {index > 0 && <View style={styles.divider} />}
                      <View style={styles.row}>
                        <View style={styles.grow}>
                          <AppText variant="body" numberOfLines={1}>
                            {describeRecord(record.metric, record.scope)}
                          </AppText>
                          <AppText variant="caption" tone="muted">
                            {new Date(record.achievedAt).toLocaleDateString()}
                          </AppText>
                        </View>
                        <AppText variant="body" weight="600">
                          {record.unit === 'count'
                            ? String(record.value)
                            : `${roundForDisplay(record.value)} ${record.unit}`}
                        </AppText>
                      </View>
                    </View>
                  ))}
                </Card>
              </Section>
            ) : null}

            {data.groups.map((group) => (
              <Section key={group.category} title={group.label}>
                <Card flush>
                  {group.items.map((item, index) => (
                    <View key={item.id}>
                      {index > 0 && <View style={styles.divider} />}
                      <View style={styles.achievement}>
                        <View style={styles.grow}>
                          <AppText variant="body" numberOfLines={1}>
                            {item.unlocked ? '✓ ' : ''}
                            {item.title}
                          </AppText>
                          {item.description ? (
                            <AppText variant="caption" tone="muted" numberOfLines={2}>
                              {item.description}
                            </AppText>
                          ) : null}
                          {!item.unlocked && item.isSecret ? (
                            <AppText variant="caption" tone="faint">
                              Keep going to reveal this one.
                            </AppText>
                          ) : null}
                        </View>
                        <AppText
                          variant="caption"
                          tone={item.unlocked ? 'success' : 'muted'}
                          style={styles.progress}
                        >
                          {item.unlocked
                            ? 'Unlocked'
                            : item.progressLabel}
                        </AppText>
                      </View>
                    </View>
                  ))}
                </Card>
              </Section>
            ))}
          </>
        )}

        <Spacer size="lg" />

        <Card>
          <AppText variant="subheading">Celebrations</AppText>
          <Spacer size="xs" />
          <AppText variant="caption" tone="muted">
            Switch off the moments LifeOS celebrates when something unlocks. Your counts and
            records stay exactly the same either way.
          </AppText>
          <Spacer size="sm" />
          <View style={styles.row}>
            <Button
              label="Show"
              onPress={() => void toggle(true)}
              variant={!quiet ? 'primary' : 'secondary'}
              size="compact"
              selected={!quiet}
              style={styles.grow}
              testID="achievements-celebrate-on"
            />
            <Spacer size="xs" />
            <Button
              label="Quiet"
              onPress={() => void toggle(false)}
              variant={quiet ? 'primary' : 'secondary'}
              size="compact"
              selected={quiet}
              style={styles.grow}
              testID="achievements-celebrate-off"
            />
          </View>
        </Card>

        <Spacer size="md" />
        <Button
          label="Recount"
          onPress={() => void evaluate.run().then(() => overview.refresh())}
          loading={evaluate.pending}
          variant="secondary"
          fullWidth
          accessibilityHint="Recalculates every achievement from your records"
          testID="achievements-recount"
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  achievement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  grow: { flex: 1 },
  progress: { maxWidth: 140, textAlign: 'right' },
  divider: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.2,
    marginHorizontal: 16,
  },
});
