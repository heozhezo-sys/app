/**
 * Units and targets.
 *
 * Units change how numbers are *presented*; targets change what the app counts towards.
 * They share a screen because a person setting up the app does both in one pass, and
 * splitting them across two screens would be tidiness at the user's expense.
 *
 * Nothing here converts stored values. Weights are integer grams and volumes are integer
 * millilitres in the database, so switching to pounds changes what you read, never what
 * you recorded — a value that changed when you changed a display setting would be a bug.
 */

import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, Section } from '@/components/Layout';
import { TextField } from '@/components/TextField';
import { useSettingsValue, useUpdateSettings } from '@/features/settings/hooks/useSettingsActions';
import { useTheme } from '@/theme/ThemeProvider';
import type {
  LengthUnit,
  TemperatureUnit,
  VolumeUnit,
  WeightUnit,
  WeekStartPreference,
} from '@/types/settings';

interface Choice<T extends string> {
  value: T;
  label: string;
}

function ChoiceRow<T extends string>({
  label,
  choices,
  selected,
  onSelect,
  testID,
}: {
  label: string;
  choices: readonly Choice<T>[];
  selected: T;
  onSelect: (value: T) => void;
  testID: string;
}): React.ReactElement {
  const theme = useTheme();

  return (
    <View style={{ marginBottom: theme.spacing.lg }}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <Spacer size="xs" />
      <View style={styles.wrapRow}>
        {choices.map((choice) => (
          <View key={choice.value} style={styles.chip}>
            <Button
              label={choice.label}
              onPress={() => onSelect(choice.value)}
              variant={selected === choice.value ? 'primary' : 'secondary'}
              size="compact"
              selected={selected === choice.value}
              testID={`${testID}-${choice.value}`}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

export default function UnitsSettingsScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const settings = useSettingsValue();
  const update = useUpdateSettings();

  const [water, setWater] = useState(String(settings.hydrationTargetMl));
  const [habitGoal, setHabitGoal] = useState(String(settings.dailyHabitGoal));

  /**
   * Numeric target entry.
   *
   * Validated here because these are the only two settings that are numbers rather than
   * enums, and an out-of-range value would be stored and then rendered as a nonsense
   * target. The value is only written once it parses.
   */
  const saveWater = useCallback(() => {
    const parsed = Number(water);
    if (!Number.isInteger(parsed) || parsed < 250 || parsed > 20_000) return;
    void update.run({ hydrationTargetMl: parsed });
  }, [update, water]);

  const saveHabitGoal = useCallback(() => {
    const parsed = Number(habitGoal);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) return;
    void update.run({ dailyHabitGoal: parsed });
  }, [habitGoal, update]);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <AppText variant="display" accessibilityRole="header">
          Units
        </AppText>
        <Spacer size="xs" />
        <AppText variant="caption" tone="muted">
          Your records are stored once, in a single unit. Changing this changes how they are
          shown, never what they are.
        </AppText>

        <Spacer size="lg" />

        <Card>
          <ChoiceRow<VolumeUnit>
            label="Volume"
            choices={[
              { value: 'ml', label: 'Millilitres' },
              { value: 'l', label: 'Litres' },
              { value: 'oz', label: 'Fluid ounces' },
            ]}
            selected={settings.volumeUnit}
            onSelect={(volumeUnit) => void update.run({ volumeUnit })}
            testID="units-volume"
          />
          <ChoiceRow<WeightUnit>
            label="Weight"
            choices={[
              { value: 'kg', label: 'Kilograms' },
              { value: 'lb', label: 'Pounds' },
            ]}
            selected={settings.weightUnit}
            onSelect={(weightUnit) => void update.run({ weightUnit })}
            testID="units-weight"
          />
          <ChoiceRow<LengthUnit>
            label="Length"
            choices={[
              { value: 'cm', label: 'Centimetres' },
              { value: 'in', label: 'Inches' },
            ]}
            selected={settings.lengthUnit}
            onSelect={(lengthUnit) => void update.run({ lengthUnit })}
            testID="units-length"
          />
          <ChoiceRow<TemperatureUnit>
            label="Temperature"
            choices={[
              { value: 'c', label: 'Celsius' },
              { value: 'f', label: 'Fahrenheit' },
            ]}
            selected={settings.temperatureUnit}
            onSelect={(temperatureUnit) => void update.run({ temperatureUnit })}
            testID="units-temperature"
          />
          <ChoiceRow<WeekStartPreference>
            label="Week starts on"
            choices={[
              { value: 'monday', label: 'Monday' },
              { value: 'sunday', label: 'Sunday' },
            ]}
            selected={settings.weekStartsOn}
            onSelect={(weekStartsOn) => void update.run({ weekStartsOn })}
            testID="units-week-start"
          />
        </Card>

        <Spacer size="lg" />

        <Section title="Targets">
          <Card>
            <TextField
              label="Water (ml a day)"
              value={water}
              onChangeText={setWater}
              keyboardType="number-pad"
              placeholder="2500"
              testID="units-water"
            />
            <AppText variant="caption" tone="faint">
              Between 250 and 20000 ml.
            </AppText>
            <Spacer size="sm" />
            <Button
              label="Save water target"
              onPress={saveWater}
              variant="secondary"
              fullWidth
              testID="units-water-save"
            />

            <Spacer size="lg" />

            <TextField
              label="Habits a day"
              value={habitGoal}
              onChangeText={setHabitGoal}
              keyboardType="number-pad"
              placeholder="3"
              testID="units-habit-goal"
            />
            <AppText variant="caption" tone="faint">
              Between 1 and 50. Used for pacing, never as a pass or fail.
            </AppText>
            <Spacer size="sm" />
            <Button
              label="Save habit goal"
              onPress={saveHabitGoal}
              variant="secondary"
              fullWidth
              testID="units-habit-goal-save"
            />
          </Card>
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { marginRight: 8, marginBottom: 8 },
});
