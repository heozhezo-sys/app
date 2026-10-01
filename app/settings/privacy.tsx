/**
 * Privacy.
 *
 * The journal lock is the one place in LifeOS where a capability can block a setting, so
 * this screen leads with *why* rather than hiding the switch. A user on a device with no
 * biometrics needs to read "this phone cannot do that" before being asked to enable a
 * lock that would silently not lock.
 *
 * The unlock flag itself lives in memory, never in the database, so closing the app
 * re-locks the journal. That is the whole point of the lock and is stated plainly rather
 * than left for the user to discover.
 */

import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, Section, StateView } from '@/components/Layout';
import { useJournalLock, useUpdateSettings } from '@/features/settings/hooks/useSettingsActions';
import { useTheme } from '@/theme/ThemeProvider';

export default function PrivacySettingsScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const update = useUpdateSettings();
  const lock = useJournalLock();

  const capability = lock.data?.capability;
  const usable = capability?.available === true && capability.enrolled === true;
  const blocked = lock.data?.blockedReason ?? null;

  const toggle = useCallback(
    async (next: boolean) => {
      // Never enable a lock that cannot be enforced. Offering the switch and then silently
      // doing nothing would be worse than not offering it at all.
      if (next && !usable) return;
      await update.run({ journalLockEnabled: next });
      await lock.refresh();
    },
    [lock, update, usable],
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
          Privacy
        </AppText>

        <Spacer size="lg" />

        <Section title="Journal lock">
          {lock.status === 'loading' ? (
            <StateView state="loading" compact loadingLabel="Checking this device" />
          ) : (
            <Card>
              <AppText variant="subheading">
                {lock.enabled
                  ? lock.data?.unlocked
                    ? 'On · unlocked'
                    : 'On · locked'
                  : 'Off'}
              </AppText>
              <Spacer size="xs" />
              <AppText variant="caption" tone="muted">
                When on, journal entries are hidden until you authenticate with your device.
                Closing the app locks it again — the unlocked state is never saved.
              </AppText>

              <Spacer size="md" />

              <View style={styles.row}>
                <Button
                  label="Off"
                  onPress={() => void toggle(false)}
                  variant={!lock.enabled ? 'primary' : 'secondary'}
                  size="compact"
                  selected={!lock.enabled}
                  style={styles.grow}
                  testID="privacy-lock-off"
                />
                <Spacer size="xs" />
                <Button
                  label="On"
                  onPress={() => void toggle(true)}
                  variant={lock.enabled ? 'primary' : 'secondary'}
                  size="compact"
                  selected={lock.enabled}
                  disabled={!usable}
                  style={styles.grow}
                  accessibilityHint={
                    usable
                      ? 'Require device authentication before showing journal entries'
                      : (blocked ?? 'Device authentication is unavailable')
                  }
                  testID="privacy-lock-on"
                />
              </View>

              {!usable ? (
                <>
                  <Spacer size="sm" />
                  <AppText variant="caption" tone="warning" accessibilityRole="alert">
                    {blocked ?? 'Device authentication is not available on this device.'}
                  </AppText>
                </>
              ) : null}

              {lock.enabled ? (
                <>
                  <Spacer size="md" />
                  <View style={styles.divider} />
                  <Spacer size="md" />
                  {lock.data?.unlocked ? (
                    <Button
                      label="Lock now"
                      onPress={() => void lock.relock.run()}
                      variant="secondary"
                      fullWidth
                      testID="privacy-lock-now"
                    />
                  ) : (
                    <Button
                      label="Unlock"
                      onPress={() => void lock.unlock.run()}
                      loading={lock.unlock.pending}
                      variant="secondary"
                      fullWidth
                      testID="privacy-unlock"
                    />
                  )}
                  {lock.unlock.error ? (
                    <>
                      <Spacer size="sm" />
                      <AppText variant="caption" tone="danger" accessibilityRole="alert">
                        {lock.unlock.error.message}
                      </AppText>
                    </>
                  ) : null}
                </>
              ) : null}
            </Card>
          )}
        </Section>

        <Section title="What stays on this device">
          <Card>
            <AppText variant="caption" tone="muted">
              Your journal, books, finance records, health data and habits are stored in a
              local database. There is no account, no analytics service and no background
              upload. Nothing leaves this device unless you export it yourself.
            </AppText>
            <Spacer size="sm" />
            <AppText variant="caption" tone="muted">
              Uninstalling the app deletes all of it. Export a backup from Data &amp; backup
              first if you want to keep it.
            </AppText>
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
    gap: 8,
  },
  grow: { flex: 1 },
  divider: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.2,
  },
});
