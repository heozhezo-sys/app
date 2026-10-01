/**
 * Settings.
 *
 * A hub rather than a form: the specification asks for progressive disclosure, so each
 * group links to the screen that owns it and this screen only shows the values a user
 * might need to check at a glance.
 *
 * Everything here is a local preference. There is no account, no sync and no network
 * call, and no screen in this file may introduce one — `OFFLINE/OFFLINE_FIRST.md` is
 * explicit that remote data is an optional enhancement only.
 */

import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, Section, StateView } from '@/components/Layout';
import {
  useJournalLock,
  useNotificationStatus,
  useSettingsValue,
  useUpdateSettings,
} from '@/features/settings/hooks/useSettingsActions';
import { currencyName } from '@/services/exchangeRateService';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * A labelled value with a disclosure affordance.
 *
 * The whole row is the tap target rather than just the chevron, so it meets the 48pt
 * minimum, and the value is part of the accessibility label so a screen reader announces
 * "Units, metric" rather than just "Units".
 */
function SettingRow({
  label,
  value,
  onPress,
  hint,
  testID,
}: {
  label: string;
  value: string;
  onPress: () => void;
  hint?: string;
  testID?: string;
}): React.ReactElement {
  return (
    <Button
      label={`${label}  ·  ${value}`}
      accessibilityLabel={`${label}, ${value}`}
      accessibilityHint={hint}
      onPress={onPress}
      variant="ghost"
      fullWidth
      style={styles.row}
      testID={testID}
    />
  );
}

const UNIT_LABELS = {
  volumeUnit: { ml: 'Millilitres', l: 'Litres', oz: 'Fluid ounces' },
  weightUnit: { kg: 'Kilograms', lb: 'Pounds' },
  lengthUnit: { cm: 'Centimetres', in: 'Inches' },
  temperatureUnit: { c: 'Celsius', f: 'Fahrenheit' },
} as const;

export default function SettingsScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const settings = useSettingsValue();
  const update = useUpdateSettings();
  const journalLock = useJournalLock();
  const notifications = useNotificationStatus();

  const go = useCallback(
    (path: string) => {
      router.push(path as never);
    },
    [router],
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
          Settings
        </AppText>
        <Spacer size="xs" />
        <AppText variant="caption" tone="muted">
          Everything on this device. LifeOS has no account and sends nothing anywhere.
        </AppText>

        <Spacer size="xl" />

        <Section title="Appearance">
          <Card flush>
            <SettingRow
              label="Theme"
              value={
                settings.appearance === 'system'
                  ? 'Match system'
                  : settings.appearance === 'dark'
                    ? 'Dark'
                    : 'Light'
              }
              onPress={() => go('/settings/appearance')}
              hint="Choose light, dark or match your device"
              testID="settings-theme"
            />
            <View style={styles.divider} />
            <SettingRow
              label="Reduce motion"
              value={settings.reduceMotionOverride ? 'Always' : 'Match system'}
              onPress={() =>
                void update.run({ reduceMotionOverride: !settings.reduceMotionOverride })
              }
              hint="Turn animation off regardless of the device setting"
              testID="settings-reduce-motion"
            />
          </Card>
        </Section>

        <Section title="Units">
          <Card flush>
            <SettingRow
              label="Volume"
              value={UNIT_LABELS.volumeUnit[settings.volumeUnit]}
              onPress={() => go('/settings/units')}
              testID="settings-volume"
            />
            <View style={styles.divider} />
            <SettingRow
              label="Weight"
              value={UNIT_LABELS.weightUnit[settings.weightUnit]}
              onPress={() => go('/settings/units')}
              testID="settings-weight"
            />
            <View style={styles.divider} />
            <SettingRow
              label="Length"
              value={UNIT_LABELS.lengthUnit[settings.lengthUnit]}
              onPress={() => go('/settings/units')}
              testID="settings-length"
            />
            <View style={styles.divider} />
            <SettingRow
              label="Temperature"
              value={UNIT_LABELS.temperatureUnit[settings.temperatureUnit]}
              onPress={() => go('/settings/units')}
              testID="settings-temperature"
            />
          </Card>
        </Section>

        <Section title="Money">
          <Card flush>
            <SettingRow
              label="Home currency"
              value={`${settings.currency} · ${currencyName(settings.currency)}`}
              onPress={() => go('/settings/currency')}
              hint="Used for budgets and the combined balance"
              testID="settings-currency"
            />
            <View style={styles.divider} />
            <SettingRow
              label="Exchange rates"
              value="Edit rates"
              onPress={() => go('/settings/currency')}
              hint="LifeOS never fetches rates; you enter the ones you want to use"
              testID="settings-rates"
            />
          </Card>
        </Section>

        <Section title="Targets">
          <Card flush>
            <SettingRow
              label="Water"
              value={`${settings.hydrationTargetMl} ml a day`}
              onPress={() => go('/settings/units')}
              testID="settings-hydration"
            />
            <View style={styles.divider} />
            <SettingRow
              label="Habits"
              value={`${settings.dailyHabitGoal} a day`}
              onPress={() => go('/settings/units')}
              testID="settings-habit-goal"
            />
            <View style={styles.divider} />
            <SettingRow
              label="Week starts"
              value={settings.weekStartsOn === 'monday' ? 'Monday' : 'Sunday'}
              onPress={() =>
                void update.run({
                  weekStartsOn: settings.weekStartsOn === 'monday' ? 'sunday' : 'monday',
                })
              }
              hint="Affects weekly budgets, calendars and weekly analytics"
              testID="settings-week-start"
            />
          </Card>
        </Section>

        <Section title="Reminders">
          <Card flush>
            <SettingRow
              label="Notifications"
              value={
                notifications.status === 'loading'
                  ? 'Checking…'
                  : notifications.data?.permission === 'granted'
                    ? `${notifications.data.enabledCount} scheduled`
                    : (notifications.data?.blockedReason ?? 'Not allowed yet')
              }
              onPress={() => go('/settings/reminders')}
              testID="settings-notifications"
            />
          </Card>
          {notifications.data?.blockedReason ? (
            <AppText variant="caption" tone="muted">
              {notifications.data.blockedReason}
            </AppText>
          ) : null}
        </Section>

        <Section title="Privacy">
          <Card flush>
            <SettingRow
              label="Journal lock"
              value={
                journalLock.status === 'loading'
                  ? 'Checking…'
                  : journalLock.data?.blockedReason
                    ? 'Unavailable'
                    : settings.journalLockEnabled
                      ? journalLock.data?.unlocked
                        ? 'On · unlocked'
                        : 'On · locked'
                      : 'Off'
              }
              onPress={() => go('/settings/privacy')}
              hint="Require device authentication before showing journal entries"
              testID="settings-journal-lock"
            />
            <View style={styles.divider} />
            <SettingRow
              label="Data &amp; backup"
              value="Export, restore, journal files"
              onPress={() => go('/settings/data')}
              hint="Back up your data to a file, or restore from one"
              testID="settings-data"
            />
          </Card>
        </Section>

        <Spacer size="xl" />

        <Card>
          <AppText variant="caption" tone="muted">
            LifeOS keeps everything in a local database on this device. Nothing is uploaded,
            and no analytics service is installed. Uninstalling the app removes your data,
            so keep a backup if it matters to you.
          </AppText>
          <Spacer size="sm" />
          <Button
            label="Back up my data"
            onPress={() => go('/settings/data')}
            variant="secondary"
            fullWidth
            testID="settings-backup-cta"
          />
        </Card>

        {update.error ? (
          <>
            <Spacer size="md" />
            <StateView state="error" errorMessage={update.error.message} />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    justifyContent: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.2,
    marginHorizontal: 16,
  },
});
