import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card } from '@/components/Layout';
import { TextField } from '@/components/TextField';
import { Swatch } from '@/components/Swatch';
import { useTheme } from '@/theme/ThemeProvider';
import { seriesColors } from '@/theme/colors';
import { validateTitle } from '@/utils/validation';
import { isDateKey } from '@/utils/dates';
import { GOAL_CATEGORIES, type GoalCategory, type GoalCreateInput } from '@/types/goals';

export interface GoalEditorProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (input: GoalCreateInput) => Promise<unknown>;
  pending: boolean;
  error: string | null;
}

/** Create sheet for a goal. Validation runs on submit and then live on change. */
export function GoalEditor({
  visible,
  onClose,
  onSubmit,
  pending,
  error,
}: GoalEditorProps): React.ReactElement {
  const theme = useTheme();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [category, setCategory] = useState<GoalCategory | null>(null);
  const [colorIndex, setColorIndex] = useState(0);
  const [titleError, setTitleError] = useState<string | undefined>(undefined);
  const [dateError, setDateError] = useState<string | undefined>(undefined);

  const reset = (): void => {
    setTitle('');
    setDescription('');
    setTargetDate('');
    setCategory(null);
    setColorIndex(0);
    setTitleError(undefined);
    setDateError(undefined);
  };

  const submit = async (): Promise<void> => {
    const nextTitleError = validateTitle(title);
    setTitleError(nextTitleError);

    const date = targetDate.trim();
    const nextDateError = date !== '' && !isDateKey(date) ? 'Use YYYY-MM-DD' : undefined;
    setDateError(nextDateError);
    if (nextTitleError || nextDateError) return;

    const created = await onSubmit({
      title,
      description: description || null,
      category,
      colorIndex,
      targetDate: date || null,
    });

    if (created) reset();
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
          style={[styles.header, { padding: theme.spacing.lg, borderBottomColor: theme.colors.border }]}
        >
          <AppText variant="title" accessibilityRole="header">
            New goal
          </AppText>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.huge }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <TextField
            label="What do you want to achieve?"
            value={title}
            onChangeText={(next) => {
              setTitle(next);
              if (titleError) setTitleError(validateTitle(next));
            }}
            error={titleError}
            placeholder="Run a 10k"
            autoFocus
            testID="goal-title"
          />

          <Spacer size="lg" />
          <TextField
            label="Why it matters (optional)"
            value={description}
            onChangeText={setDescription}
            placeholder="What changes if you get there?"
            multiline
          />

          <Spacer size="lg" />
          <TextField
            label="Target date (optional)"
            value={targetDate}
            onChangeText={(next) => {
              setTargetDate(next);
              if (dateError) {
                const value = next.trim();
                setDateError(value !== '' && !isDateKey(value) ? 'Use YYYY-MM-DD' : undefined);
              }
            }}
            error={dateError}
            placeholder="2026-06-01"
            keyboardType="numbers-and-punctuation"
          />

          <Spacer size="lg" />
          <AppText variant="caption" tone="muted">
            Category
          </AppText>
          <Spacer size="sm" />
          <View style={styles.row}>
            <Button
              label="None"
              size="compact"
              variant={category === null ? 'primary' : 'secondary'}
              onPress={() => setCategory(null)}
            />
            {GOAL_CATEGORIES.map((option) => (
              <Button
                key={option}
                label={option}
                size="compact"
                variant={category === option ? 'primary' : 'secondary'}
                onPress={() => setCategory(option)}
                accessibilityHint={
                  category === option ? 'Selected. Tap to clear.' : `Categorise as ${option}.`
                }
              />
            ))}
          </View>

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
                selected={colorIndex === index}
                onPress={() => setColorIndex(index)}
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
            label="Create goal"
            onPress={() => void submit()}
            loading={pending}
            fullWidth
            testID="goal-submit"
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
