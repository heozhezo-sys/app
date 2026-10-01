/**
 * Reminders.
 *
 * `FEATURES/NOTIFICATIONS.md` asks for local reminders that work offline. This screen is
 * the honest half of that promise: it shows what is scheduled, what the OS will actually
 * allow, and gives the user a way to re-arm reminders after an update — because Android
 * drops pending alarms on reboot and both platforms drop them on update, and without that
 * button a user's reminders would silently stop working with no explanation.
 *
 * Permission is only requested from the button below, never on screen load: a system
 * dialog that appears unprompted is the fastest way to make someone deny it permanently.
 */

import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, Section, StateView } from '@/components/Layout';
import {
  useCancelReminder,
  useEnabledReminders,
  useNotificationStatus,
  useRehydrateReminders,
  useRequestNotificationPermission,
  useSettingsValue,
  useUpdateSettings,
} from '@/features/settings/hooks/useSettingsActions';
import { useTheme } from '@/theme/ThemeProvider';

const CADENCE_LABELS: Record<string, string> = {
  once: 'Once',
  daily: 'Every day',
  weekdays: 'On chosen weekdays',
  weekly: 'Every week',
  monthly: 'Every month',
};

/** Local date and time, because a reminder time means local time wherever you are. */
function fireLabel(instant: number): string {
  const date = new Date(instant);
  const day = date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
}

export default function RemindersSettingsScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const settings = useSettingsValue();
  const update = useUpdateSettings();
  const status = useNotificationStatus();
  const reminders = useEnabledReminders();
  const requestPermission = useRequestNotificationPermission();
  const cancel = useCancelReminder();
  const rehydrate = useRehydrateReminders();

  const refreshAll = useCallback(async () => {
    await Promise.all([status.refresh(), reminders.refresh()]);
  }, [reminders, status]);

  const permission = status.data?.permission;

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
          Reminders
        </AppText>
        <Spacer size="xs" />
        <AppText variant="caption" tone="muted">
          Reminders are scheduled on this device and fire without a connection.
        </AppText>

        <Spacer size="lg" />

        {status.status === 'loading' ? (
          <StateView state="loading" loadingLabel="Checking reminders" />
        ) : (
          <Card>
            <AppText variant="subheading">
              {permission === 'granted'
                ? 'Allowed'
                : permission === 'denied'
                  ? 'Blocked'
                  : 'Not decided'}
            </AppText>
            <Spacer size="xs" />
            <AppText variant="caption" tone="muted">
              {status.data?.blockedReason ??
                'LifeOS can send reminders for the things you schedule.'}
            </AppText>

            <Spacer size="md" />

            <Button
              label="Allow reminders"
              onPress={() => void requestPermission.run().then(refreshAll)}
              loading={requestPermission.pending}
              disabled={permission === 'granted' || status.data?.available === false}
              fullWidth
              testID="reminders-allow"
            />
            {permission === 'denied' ? (
              <>
                <Spacer size="sm" />
                <AppText variant="caption" tone="muted">
                  To allow reminders, turn them on for LifeOS in your device settings. That
                  is a deliberate step rather than something this app can do for you.
                </AppText>
              </>
            ) : null}

            <Spacer size="md" />
            <View style={styles.divider} />

            <Spacer size="md" />
            <AppText variant="body">Reminders in general</AppText>
            <Spacer size="xs" />
            <AppText variant="caption" tone="muted">
              Turning this off keeps everything you have scheduled but stops LifeOS arming
              any new reminders.
            </AppText>
            <Spacer size="sm" />
            <View style={styles.row}>
              <Button
                label="Off"
                onPress={() => void update.run({ notificationsEnabled: false })}
                variant={!settings.notificationsEnabled ? 'primary' : 'secondary'}
                size="compact"
                selected={!settings.notificationsEnabled}
                style={styles.grow}
                testID="reminders-master-off"
              />
              <Spacer size="xs" />
              <Button
                label="On"
                onPress={() => void update.run({ notificationsEnabled: true })}
                variant={settings.notificationsEnabled ? 'primary' : 'secondary'}
                size="compact"
                selected={settings.notificationsEnabled}
                style={styles.grow}
                testID="reminders-master-on"
              />
            </View>
          </Card>
        )}

        <Section title="Scheduled">
          {reminders.status === 'loading' ? (
            <StateView state="loading" compact loadingLabel="Loading reminders" />
          ) : (reminders.data ?? []).length === 0 ? (
            <StateView
              state="empty"
              compact
              emptyTitle="Nothing scheduled"
              emptyBody="Reminders you add to a habit, goal or workout appear here."
            />
          ) : (
            <Card flush>
              {(reminders.data ?? []).map((reminder, index) => (
                <View key={reminder.id}>
                  {index > 0 && <View style={styles.divider} />}
                  <View style={styles.row}>
                    <View style={styles.grow}>
                      <AppText variant="body" numberOfLines={1}>
                        {reminder.title}
                      </AppText>
                      <AppText variant="caption" tone="muted">
                        {fireLabel(reminder.fireAt)} ·{' '}
                        {CADENCE_LABELS[reminder.cadence ?? 'once'] ?? reminder.cadence}
                      </AppText>
                      {reminder.body ? (
                        <AppText variant="caption" tone="faint" numberOfLines={2}>
                          {reminder.body}
                        </AppText>
                      ) : null}
                    </View>
                    <Button
                      label="Cancel"
                      variant="ghost"
                      size="compact"
                      onPress={() => void cancel.run(reminder.id).then(refreshAll)}
                      accessibilityHint={`Cancel the reminder ${reminder.title}`}
                      testID={`reminders-cancel-${reminder.id}`}
                    />
                  </View>
                </View>
              ))}
            </Card>
          )}
        </Section>

        <Section title="After an app update">
          <Card>
            <AppText variant="caption" tone="muted">
              Your phone clears scheduled reminders when LifeOS is updated, and Android also
              clears them after a restart. Re-arm them here if they stop arriving.
            </AppText>
            <Spacer size="sm" />
            <Button
              label="Re-arm all reminders"
              onPress={() => void rehydrate.run().then(refreshAll)}
              loading={rehydrate.pending}
              variant="secondary"
              fullWidth
              testID="reminders-rehydrate"
            />
            {rehydrate.error ? (
              <>
                <Spacer size="sm" />
                <StateView state="error" errorMessage={rehydrate.error.message} compact />
              </>
            ) : null}
          </Card>
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  grow: { flex: 1 },
  divider: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.2,
    marginHorizontal: 16,
  },
});
