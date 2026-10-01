/**
 * Focus timer screen.
 *
 * The countdown is a rendering of a stored deadline, so it is correct after backgrounding,
 * screen lock, suspension and reopening without persisting any tick state (ADR-0005).
 */

import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, StateView } from '@/components/Layout';
import {
  useActiveFocus,
  useAbandonFocus,
  useCompleteFocus,
  useFocusTotals,
  useStartFocus,
} from '@/features/focus/hooks/useFocus';
import { formatCountdown } from '@/focus/timerMath';
import { FOCUS_PRESETS, type FocusKind } from '@/focus/presets';
import { useTheme } from '@/theme/ThemeProvider';

export default function FocusScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const active = useActiveFocus();
  const totals = useFocusTotals();
  const start = useStartFocus();
  const complete = useCompleteFocus();
  const abandon = useAbandonFocus();

  const [message, setMessage] = useState<string | null>(null);
  const view = active.data;
  const timer = view?.timer;

  /*
   * "Time is up" is *derived* from the timer rather than copied into state by an effect.
   * A finished timer therefore stays on screen until the user acts — auto-resolving here
   * would hide the moment and race someone still deciding whether they finished early.
   */
  const notice = timer?.expired ? 'Time is up.' : message;

  const onStart = useCallback(
    async (kind: FocusKind) => {
      setMessage(null);
      const result = await start.run({ kind });
      if (!result) return;
      if (!result.ok && result.error.kind === 'already_running') {
        setMessage('A session is already running.');
      }
      await active.refresh();
    },
    [active, start],
  );

  const onComplete = useCallback(async () => {
    if (!view) return;
    await complete.run(view.session.id);
    setMessage(null);
    await active.refresh();
    await totals.refresh();
  }, [active, complete, totals, view]);

  const onAbandon = useCallback(async () => {
    if (!view) return;
    await abandon.run(view.session.id);
    setMessage(null);
    await active.refresh();
    await totals.refresh();
  }, [abandon, active, totals, view]);

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
          Focus
        </AppText>
        <AppText variant="subheading" tone="muted">
          {totals.data
            ? `${totals.data.focusMinutes} min today · ${totals.data.completed} completed`
            : 'Today'}
        </AppText>

        <Spacer size="lg" />

        {notice ? (
          <>
            <Card>
              <AppText variant="caption" tone="danger" accessibilityRole="alert">
                {notice}
              </AppText>
            </Card>
            <Spacer size="md" />
          </>
        ) : null}

        {view ? (
          <Card>
            <AppText variant="subheading">
              {view.session.intent ?? view.session.label ?? 'Focus session'}
            </AppText>
            <Spacer size="xs" />

            {/* Announced politely so the change is spoken without interrupting. */}
            <AppText
              variant="display"
              accessibilityLiveRegion="polite"
              accessibilityLabel={`${formatCountdown(timer?.remainingMs ?? 0)} remaining`}
            >
              {formatCountdown(timer?.remainingMs ?? 0)}
            </AppText>
            <AppText variant="caption" tone="muted">
              {timer?.expired
                ? 'Finished'
                : `of ${view.session.plannedMin} minutes · session ${view.session.cycleIndex}`}
            </AppText>

            <Spacer size="md" />

            {/* The bar is decorative. The countdown above carries the meaning, so a screen
                reader is not handed a meaningless percentage to announce. */}
            <View
              style={[
                styles.track,
                { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.pill },
              ]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <View
                style={[
                  styles.fill,
                  {
                    backgroundColor: theme.colors.accent,
                    borderRadius: theme.radii.pill,
                    width: `${Math.round((timer?.remainingFraction ?? 0) * 100)}%`,
                  },
                ]}
              />
            </View>

            <Spacer size="md" />

            <Button
              label="Finish now"
              onPress={() => void onComplete()}
              loading={complete.pending}
              disabled={complete.pending}
              fullWidth
              testID="focus-finish"
            />
            <Spacer size="sm" />
            <Button
              label="Abandon session"
              variant="ghost"
              onPress={() => void onAbandon()}
              loading={abandon.pending}
              disabled={abandon.pending}
              fullWidth
            />
          </Card>
        ) : active.status === 'loading' ? (
          <StateView state="loading" loadingLabel="Reading the timer" />
        ) : (
          <>
            <Card>
              <AppText variant="subheading">Start a session</AppText>
              <Spacer size="xs" />
              <AppText variant="caption" tone="muted">
                The timer keeps running when the app is closed. It is measured against the
                clock, so reopening shows the time that is actually left.
              </AppText>
              <Spacer size="md" />

              {FOCUS_PRESETS.map((preset) => (
                <View key={preset.kind} style={{ marginBottom: theme.spacing.sm }}>
                  <Button
                    label={`${preset.label} minutes`}
                    variant="secondary"
                    onPress={() => void onStart(preset.kind)}
                    loading={start.pending}
                    disabled={start.pending}
                    accessibilityHint={`Focus for ${preset.focusMinutes} minutes, then a ${preset.breakMinutes} minute break`}
                    fullWidth
                    testID={`focus-preset-${preset.kind}`}
                  />
                </View>
              ))}
            </Card>

            {active.error ? (
              <>
                <Spacer size="md" />
                <StateView
                  state="error"
                  errorMessage={active.error.message}
                  onRetry={() => void active.refresh()}
                  compact
                />
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 6,
    overflow: 'hidden',
  },
  fill: {
    height: 6,
  },
});

