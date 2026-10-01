/**
 * Nutrition.
 *
 * Manual food database and meal logging, with daily totals derived from the stored
 * entries. No online food service is involved: everything works offline, as the
 * specification requires.
 */

import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, StateView } from '@/components/Layout';
import { TextField } from '@/components/TextField';
import {
  useCreateFood,
  useFoods,
  useLogFood,
  useNutritionDay,
  useRemoveNutritionEntry,
  useToday,
} from '@/features/health/hooks/useHealth';
import { isValidationError } from '@/services/errors';
import { MEAL_LABELS, MEALS, formatGrams, type Meal } from '@/health/nutritionMath';
import { useTheme } from '@/theme/ThemeProvider';

export default function NutritionScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const date = useToday();

  const day = useNutritionDay(date);
  const foods = useFoods();
  const createFood = useCreateFood();
  const logFood = useLogFood();
  const removeEntry = useRemoveNutritionEntry();

  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [meal, setMeal] = useState<Meal>('snack');

  const refreshAll = useCallback(async () => {
    await day.refresh();
    await foods.refresh();
  }, [day, foods]);

  const saveFood = useCallback(async () => {
    setErrors({});
    try {
      await createFood.run({
        name,
        servingGrams: 100,
        calories: Number(calories) || 0,
        proteinGrams: Number(protein) || 0,
        carbsGrams: 0,
        fatGrams: 0,
        fiberGrams: 0,
      });
      setName('');
      setCalories('');
      setProtein('');
      await foods.refresh();
    } catch (error) {
      if (isValidationError(error)) {
        setErrors(error.fields as Record<string, string>);
        return;
      }
      setErrors({ name: 'That food could not be saved.' });
    }
  }, [calories, createFood, foods, name, protein]);

  const data = day.data;

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
          Nutrition
        </AppText>

        <Spacer size="lg" />

        <Card>
          <AppText variant="subheading">Today</AppText>
          <Spacer size="xs" />
          {day.status === 'loading' || !data ? (
            <StateView state="loading" compact loadingLabel="Loading totals" />
          ) : (
            <>
              <AppText variant="display" accessibilityLabel={`${data.totals.calories} calories`}>
                {data.totals.calories}
              </AppText>
              <AppText variant="caption" tone="muted">
                kcal · protein {formatGrams(data.totals.proteinG)} g · carbs{' '}
                {formatGrams(data.totals.carbsG)} g · fat {formatGrams(data.totals.fatG)} g
              </AppText>
            </>
          )}
        </Card>

        <Spacer size="md" />

        <AppText variant="subheading">Add a food</AppText>
        <Spacer size="xs" />

        <Card>
          <TextField
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Greek yoghurt"
            error={errors.name}
            testID="food-name"
          />
          <Spacer size="sm" />
          <TextField
            label="Calories per 100 g"
            value={calories}
            onChangeText={setCalories}
            placeholder="120"
            keyboardType="number-pad"
            error={errors.calories}
            testID="food-calories"
          />
          <Spacer size="sm" />
          <TextField
            label="Protein per 100 g"
            value={protein}
            onChangeText={setProtein}
            placeholder="15"
            keyboardType="decimal-pad"
            error={errors.proteinGrams}
            testID="food-protein"
          />

          <Spacer size="md" />
          <AppText variant="caption" tone="muted">
            Meal
          </AppText>
          <Spacer size="xs" />
          <View style={styles.row}>
            {MEALS.map((option) => (
              <Button
                key={option}
                label={MEAL_LABELS[option]}
                variant={option === meal ? 'primary' : 'secondary'}
                onPress={() => setMeal(option)}
                accessibilityHint={`Log as ${MEAL_LABELS[option]}`}
              />
            ))}
          </View>

          <Spacer size="md" />
          <Button
            label="Save food"
            onPress={() => void saveFood()}
            disabled={createFood.pending}
            fullWidth
            testID="food-save"
          />
        </Card>

        <Spacer size="md" />

        <AppText variant="subheading">Saved foods</AppText>
        <Spacer size="xs" />

        {foods.status === 'loading' ? (
          <StateView state="loading" compact loadingLabel="Loading foods" />
        ) : (foods.data ?? []).length === 0 ? (
          <Card>
            <AppText variant="caption" tone="muted">
              No foods saved yet. Add one above to start a personal food list.
            </AppText>
          </Card>
        ) : (
          <View style={{ gap: theme.spacing.xs }}>
            {(foods.data ?? []).map((food) => (
              <Card key={food.id} flush>
                <View style={styles.row}>
                  <View style={styles.details}>
                    <AppText variant="subheading">{food.name}</AppText>
                    <AppText variant="caption" tone="muted">
                      {food.calories} kcal · protein {formatGrams(food.proteinG)} g per{' '}
                      {food.servingGrams} g
                    </AppText>
                  </View>
                  <Button
                    label="Log"
                    variant="secondary"
                    size="compact"
                    onPress={() => {
                      void logFood.run({ foodId: food.id, servings: 1, meal }).then(refreshAll);
                    }}
                    accessibilityHint={`Log one serving of ${food.name} as ${MEAL_LABELS[meal]}`}
                    testID={`log-${food.id}`}
                  />
                </View>
              </Card>
            ))}
          </View>
        )}

        {(data?.entries.length ?? 0) > 0 ? (
          <>
            <Spacer size="md" />
            <AppText variant="subheading">Logged today</AppText>
            <Spacer size="xs" />
            <View style={{ gap: theme.spacing.xs }}>
              {(data?.entries ?? []).map((entry) => (
                <Card key={entry.id} flush>
                  <View style={styles.row}>
                    <View style={styles.details}>
                      <AppText variant="subheading">{entry.name}</AppText>
                      <AppText variant="caption" tone="muted">
                        {MEAL_LABELS[entry.meal]} · {entry.nutrition.calories} kcal
                      </AppText>
                    </View>
                    <Button
                      label="Remove"
                      variant="ghost"
                      size="compact"
                      onPress={() => {
                        void removeEntry.run(entry.id).then(refreshAll);
                      }}
                      accessibilityHint={`Remove the ${entry.name} entry`}
                    />
                  </View>
                </Card>
              ))}
            </View>
          </>
        ) : null}
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
    flexWrap: 'wrap',
  },
  details: {
    flexShrink: 1,
    gap: 2,
  },
});
