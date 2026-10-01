import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card } from '@/components/Layout';
import { TextField } from '@/components/TextField';
import { Swatch } from '@/components/Swatch';
import { useTheme } from '@/theme/ThemeProvider';
import { seriesColors } from '@/theme/colors';
import {
  emptyHabitForm,
  validateHabitForm,
  type HabitFormValues,
} from '@/services/habitsService';
import type { HabitCreateInput } from '@/types/habits';

const WEEKDAYS = [
  { value: 1, label: 'M' },
  { value: 2, label: 'T' },
  { value: 3, label: 'W' },
  { value: 4, label: 'T' },
  { value: 5, label: 'F' },
  { value: 6, label: 'S' },
  { value: 0, label: 'S' },
];

export interface HabitEditorProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (input: HabitCreateInput) => Promise<unknown>;
  pending: boolean;
  error: string | null;
}

/**
 * Create sheet for a habit. Validation runs on submit and then on every change, so a
 * corrected field clears its error immediately.
 */
export function HabitEditor({
  visible,
  onClose,
  onSubmit,
  pending,
  error,
}: HabitEditorProps): React.ReactElement {
  const theme = useTheme();
  const [values, setValues] = useState<HabitFormValues>(emptyHabitForm);
  const [errors, setErrors] = useState<Partial<Record<keyof HabitFormValues, string>>>({});
  const [submitted, setSubmitted] = useState(false);

  const set = <K extends keyof HabitFormValues>(key: K, value: HabitFormValues[K]): void => {
    const next = { ...values, [key]: value };
    setValues(next);
    if (submitted) setErrors(validateHabitForm(next));
  };

  const toggleDay = (day: number): void => {
    set(
      'cadenceDays',
      values.cadenceDays.includes(day)
        ? values.cadenceDays.filter((d) => d !== day)
        : [...values.cadenceDays, day],
    );
  };

  const submit = async (): Promise<void> => {
    setSubmitted(true);
    const found = validateHabitForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const created = await onSubmit({
      title: values.title,
      description: values.description || null,
      colorIndex: values.colorIndex,
      cadence: values.cadenceDays.length > 0 ? 'specific_days' : 'daily',
      cadenceDays: values.cadenceDays,
      targetPerPeriod: Number(values.targetPerPeriod) || 1,
      reminderTime: values.reminderTime.trim() || null,
    });

    if (created) {
      setValues(emptyHabitForm());
      setErrors({});
      setSubmitted(false);
    }
  };

return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
        <View
          style={[
            styles.header,
            { padding: theme.spacing.lg, borderBottomColor: theme.colors.border },
          ]}
        >
          <AppText variant="title" accessibilityRole="header">
            New habit
          </AppText>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.huge }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <TextField
            label="What do you want to do?"
            value={values.title}
            onChangeText={(t) => set('title', t)}
            error={errors.title}
            placeholder="Read for 20 minutes"
            autoFocus
            testID="habit-title"
          />

          <Spacer size="lg" />
          <TextField
            label="Notes (optional)"
            value={values.description}
            onChangeText={(t) => set('description', t)}
            placeholder="Why this matters to you"
            multiline
          />

          <Spacer size="lg" />
          <AppText variant="caption" tone="muted">
            Repeat on
          </AppText>
          <Spacer size="sm" />
          <View style={styles.row}>
            {WEEKDAYS.map((day) => {
              const selected = values.cadenceDays.includes(day.value);
              return (
                <Button
                  key={day.value}
                  label={day.label}
                  size="compact"
                  variant={selected ? 'primary' : 'secondary'}
                  onPress={() => toggleDay(day.value)}
                  accessibilityHint={selected ? 'Selected. Tap to remove.' : 'Not selected.'}
                  testID={`weekday-${day.value}`}
                />
              );
            })}
          </View>
          <Spacer size="xs" />
          <AppText variant="micro" tone="faint">
            {values.cadenceDays.length === 0 ? 'Every day' : 'On the days you selected'}
          </AppText>

          <Spacer size="lg" />
          <TextField
            label="Times per day or week"
            value={values.targetPerPeriod}
            onChangeText={(t) => set('targetPerPeriod', t)}
            error={errors.targetPerPeriod}
            keyboardType="number-pad"
            placeholder="1"
          />

          <Spacer size="lg" />
          <TextField
            label="Reminder (optional)"
            value={values.reminderTime}
            onChangeText={(t) => set('reminderTime', t)}
            error={errors.reminderTime}
            placeholder="08:00"
            keyboardType="numbers-and-punctuation"
          />

          <Spacer size="lg" />
          <AppText variant="caption" tone="muted">
            Colour
          </AppText>
          <Spacer size="sm" />
          <View style={styles.row}>
            {seriesColors.map((color, index) => (
              <Swatch
                key={color}
                color={color}
                selected={values.colorIndex === index}
                onPress={() => set('colorIndex', index)}
                label={`Colour ${index + 1}`}
              />
            ))}
          </View>

          {error ? (
            <>
              <Spacer size="lg" />
              <Card style={{ borderColor: theme.colors.danger }}>
                <AppText tone="danger" accessibilityLiveRegion="assertive">
                  {error}
                </AppText>
              </Card>
            </>
          ) : null}

          <Spacer size="xl" />
          <Button
            label="Create habit"
            onPress={() => void submit()}
            loading={pending}
            fullWidth
            testID="habit-submit"
          />
          <Spacer size="sm" />
          <Button label="Cancel" onPress={onClose} variant="ghost" fullWidth />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
