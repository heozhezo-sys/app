/**
 * Appearance.
 *
 * Theme and motion, kept apart from the general units screen because both change what the
 * rest of the app looks like immediately — the user needs to see the result of a tap
 * without navigating away.
 */

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, Section } from '@/components/Layout';
import { useSettingsValue, useUpdateSettings } from '@/features/settings/hooks/useSettingsActions';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppearancePreference } from '@/types/settings';

const THEMES: { value: AppearancePreference; label: string; description: string }[] = [
  { value: 'system', label: 'Match device', description: 'Follows your phone or tablet setting.' },
  { value: 'light', label: 'Light', description: 'Always light, whatever the device says.' },
  { value: 'dark', label: 'Dark', description: 'Always dark, whatever the device says.' },
];

export default function AppearanceSettingsScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const settings = useSettingsValue();
  const update = useUpdateSettings();

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
          Appearance
        </AppText>

        <Spacer size="lg" />

        <Section title="Theme">
          <Card>
            {THEMES.map((option, index) => (
              <View key={option.value}>
                {index > 0 && <View style={styles.divider} />}
                <View style={styles.optionRow}>
                  <View style={styles.grow}>
                    <AppText variant="body">{option.label}</AppText>
                    <AppText variant="caption" tone="muted">
                      {option.description}
                    </AppText>
                  </View>
                  <Button
                    label={settings.appearance === option.value ? 'On' : 'Use'}
                    onPress={() => void update.run({ appearance: option.value })}
                    variant={settings.appearance === option.value ? 'primary' : 'secondary'}
                    size="compact"
                    selected={settings.appearance === option.value}
                    accessibilityHint={option.description}
                    testID={`appearance-${option.value}`}
                  />
                </View>
              </View>
            ))}
          </Card>
        </Section>

        <Section title="Motion">
          <Card>
            <AppText variant="body">Reduce motion</AppText>
            <Spacer size="xs" />
            <AppText variant="caption" tone="muted">
              Turns off transitions and celebration animations. Choose &ldquo;Match
              device&rdquo; to follow the accessibility setting your phone already has.
            </AppText>
            <Spacer size="sm" />
            <View style={styles.optionRow}>
              <Button
                label="Match device"
                onPress={() => void update.run({ reduceMotionOverride: false })}
                variant={!settings.reduceMotionOverride ? 'primary' : 'secondary'}
                size="compact"
                selected={!settings.reduceMotionOverride}
                style={styles.grow}
                testID="appearance-motion-system"
              />
              <Spacer size="xs" />
              <Button
                label="Always reduce"
                onPress={() => void update.run({ reduceMotionOverride: true })}
                variant={settings.reduceMotionOverride ? 'primary' : 'secondary'}
                size="compact"
                selected={settings.reduceMotionOverride}
                style={styles.grow}
                testID="appearance-motion-always"
              />
            </View>
          </Card>
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  grow: { flex: 1 },
  divider: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.2,
    marginVertical: 8,
  },
});
