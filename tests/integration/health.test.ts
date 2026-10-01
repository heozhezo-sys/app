/**
 * Hydration, nutrition and sleep, end to end through service -> repository -> real SQLite.
 *
 * The two things worth protecting with real SQL rather than a pure-function test are the
 * schema's own guarantees (integer columns, the `wake_time >= bedtime` check) and the
 * snapshot rule that keeps a food edit from rewriting history.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import {
  __resetDatabaseHandleForTests,
  __setDatabaseHandleForTests,
  getDatabase,
} from '@/database/database';
import { runMigrations } from '@/database/migrator';
import { LATEST_SCHEMA_VERSION } from '@/database/migrations/types';
import * as health from '@/services/healthService';
import { ValidationError } from '@/services/errors';
import { todayKey } from '@/utils/dates';

let driver: NodeSqliteDriver;
let now = new Date(2026, 0, 15, 9, 0).getTime();

beforeEach(async () => {
  driver = new NodeSqliteDriver();
  await runMigrations(driver);
  __setDatabaseHandleForTests(driver, LATEST_SCHEMA_VERSION);
  now = new Date(2026, 0, 15, 9, 0).getTime();
  health.setClock(() => now);
});

afterEach(async () => {
  health.resetClock();
  __resetDatabaseHandleForTests();
  await driver.close();
});

function today(): string {
  return todayKey(new Date(now));
}

async function makeFood(overrides: Partial<Parameters<typeof health.createFood>[0]> = {}) {
  return health.createFood({
    name: 'Greek yoghurt',
    servingGrams: 150,
    calories: 120,
    proteinGrams: 15,
    carbsGrams: 8,
    fatGrams: 2,
    fiberGrams: 0,
    ...overrides,
  });
}

describe('hydration', () => {
  it('records an intake against the local calendar day', async () => {
    const log = await health.addWater({ amountMl: 250 });

    expect(log.amountMl).toBe(250);
    // Local, not UTC: `log_date` is the day the user means.
    expect(log.logDate).toBe(today());
  });

  it('totals a day across several entries', async () => {
    await health.addWater({ amountMl: 250 });
    await health.addWater({ amountMl: 500 });
    await health.addWater({ amountMl: 750 });

    const day = await health.hydrationForDay(today());
    expect(day.totalMl).toBe(1500);
    expect(day.targetMl).toBe(2000);
    expect(day.percent).toBe(75);
  });

  it('reports zero for a day with nothing logged', async () => {
    const day = await health.hydrationForDay(today());
    expect(day.totalMl).toBe(0);
    expect(day.percent).toBe(0);
  });

  it('caps the percentage at one hundred', async () => {
    // Deliberate: the feature must not imply that more water is better.
    await health.addWater({ amountMl: 5000 });
    const day = await health.hydrationForDay(today());
    expect(day.percent).toBe(100);
    expect(day.totalMl).toBe(5000);
  });

  it('keeps separate days separate', async () => {
    await health.addWater({ amountMl: 500, logDate: '2026-01-14' });
    await health.addWater({ amountMl: 250, logDate: '2026-01-15' });

    expect((await health.hydrationForDay('2026-01-14')).totalMl).toBe(500);
    expect((await health.hydrationForDay('2026-01-15')).totalMl).toBe(250);
  });

  it('adds from typed text in any supported unit', async () => {
    await health.addWaterText('1.5 l');
    await health.addWaterText('500ml');

    expect((await health.hydrationForDay(today())).totalMl).toBe(2000);
  });

  it('returns null for text it cannot parse rather than logging a guess', async () => {
    expect(await health.addWaterText('two cups')).toBeNull();
    expect((await health.hydrationForDay(today())).totalMl).toBe(0);
  });

  it('rejects a zero or negative amount', async () => {
    await expect(health.addWater({ amountMl: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(health.addWater({ amountMl: -100 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an absurdly large single entry', async () => {
    await expect(health.addWater({ amountMl: 50_000 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('removes an entry and lowers the total', async () => {
    const log = await health.addWater({ amountMl: 500 });
    await health.removeWater(log.id);

    expect((await health.hydrationForDay(today())).totalMl).toBe(0);
  });

  it("lists a day's entries newest first", async () => {
    await health.addWater({ amountMl: 250, loggedAt: now - 10_000 });
    await health.addWater({ amountMl: 500, loggedAt: now });

    const logs = await health.waterLogs(today());
    expect(logs[0]?.amountMl).toBe(500);
    expect(logs[1]?.amountMl).toBe(250);
  });
});
describe('nutrition', () => {
  it('stores macros as integer tenths of a gram', async () => {
    const food = await makeFood();

    expect(food.proteinG).toBe(150);
    expect(food.carbsG).toBe(80);
    expect(food.fatG).toBe(20);
  });

  it('rejects a food with no name', async () => {
    await expect(makeFood({ name: '  ' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects negative nutrition values', async () => {
    await expect(makeFood({ calories: -1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(makeFood({ proteinGrams: -1 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a zero serving size', async () => {
    await expect(makeFood({ servingGrams: 0 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('logs an intake scaled by servings', async () => {
    const food = await makeFood();

    const entry = await health.logFood({ foodId: food.id, servings: 2, meal: 'breakfast' });

    expect(entry.name).toBe('Greek yoghurt');
    expect(entry.servingsX100).toBe(200);
    expect(entry.nutrition.calories).toBe(240);
    expect(entry.nutrition.proteinG).toBe(300);
  });

  it('stores a snapshot that survives editing the food', async () => {
    const food = await makeFood();
    const entry = await health.logFood({ foodId: food.id, servings: 1, meal: 'lunch' });

    // Correcting the food must not rewrite what was eaten.
    await health.editFood(food.id, { calories: 999, proteinG: 0 });

    // Asserted against the stored columns, not a re-read of the food row.
    const db = (await getDatabase()).driver;
    const row = await db.first<{ calories: number; protein_g_x10: number }>(
      'SELECT calories, protein_g_x10 FROM nutrition_entries WHERE id = ?;',
      [entry.id],
    );
    expect(row?.calories).toBe(120);
    expect(row?.protein_g_x10).toBe(150);
  });

  it('groups entries by local day, including a late-night one', async () => {
    const food = await makeFood();

    await health.logFood({
      foodId: food.id,
      servings: 1,
      meal: 'dinner',
      eatenAt: new Date(2026, 0, 15, 23, 59).getTime(),
    });
    await health.logFood({
      foodId: food.id,
      servings: 1,
      meal: 'snack',
      eatenAt: new Date(2026, 0, 16, 0, 1).getTime(),
    });

    const day = await health.nutritionForDay('2026-01-15');
    // 23:59 belongs to the 15th; 00:01 the next morning does not.
    expect(day.entries).toHaveLength(1);
    expect(day.totals.calories).toBe(120);
  });

  it('totals a day and breaks it down by meal', async () => {
    const food = await makeFood();
    await health.logFood({ foodId: food.id, servings: 1, meal: 'breakfast' });
    await health.logFood({ foodId: food.id, servings: 2, meal: 'lunch' });

    const day = await health.nutritionForDay(today());
    expect(day.totals.calories).toBe(360);
    expect(day.byMeal.breakfast).toHaveLength(1);
    expect(day.byMeal.lunch).toHaveLength(1);
    expect(day.byMeal.dinner).toHaveLength(0);
  });

  it('rejects an unknown meal', async () => {
    const food = await makeFood();
    await expect(
      health.logFood({ foodId: food.id, servings: 1, meal: 'brunch' as never }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a non-positive serving count', async () => {
    const food = await makeFood();
    await expect(
      health.logFood({ foodId: food.id, servings: 0, meal: 'lunch' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a food that no longer exists', async () => {
    await expect(
      health.logFood({ foodId: 'nope', servings: 1, meal: 'lunch' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('logs an ad-hoc intake with no saved food', async () => {
    const entry = await health.logAdHoc({
      name: 'Coffee',
      meal: 'snack',
      nutrition: { calories: 5, proteinG: 0, carbsG: 1, fatG: 0, fiberG: 0 },
    });

    expect(entry.foodId).toBeNull();
    expect(entry.name).toBe('Coffee');
  });

  it('removes an entry', async () => {
    const food = await makeFood();
    const entry = await health.logFood({ foodId: food.id, servings: 1, meal: 'lunch' });

    await health.removeNutritionEntry(entry.id);
    expect((await health.nutritionForDay(today())).entries).toHaveLength(0);
  });
});

describe('sleep', () => {
  it('logs a night that crosses midnight', async () => {
    // 23:00 to 07:00 satisfies the schema only because the dates are resolved correctly.
    const log = await health.logSleep({ bedtime: '23:00', wakeTime: '07:00' });

    expect(log.durationMin).toBe(480);
    expect(log.bedtime).toBeLessThan(log.wakeTime);
    expect(log.sleepDate).toBe(today());
  });

  it('logs a same-day nap', async () => {
    const log = await health.logSleep({ bedtime: '14:00', wakeTime: '14:30' });
    expect(log.durationMin).toBe(30);
  });

  it('stores the bedtime on the previous evening for a late night', async () => {
    const log = await health.logSleep({
      sleepDate: '2026-03-01',
      bedtime: '23:30',
      wakeTime: '07:30',
    });

    expect(new Date(log.bedtime).getDate()).toBe(28);
    expect(log.durationMin).toBe(480);
  });

  it('rejects an impossible time', async () => {
    await expect(
      health.logSleep({ bedtime: '99:99', wakeTime: '07:00' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a duration beyond the limit', async () => {
    await expect(
      health.logSleep({ bedtime: '08:00', wakeTime: '07:00' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a quality outside one to ten', async () => {
    await expect(
      health.logSleep({ bedtime: '23:00', wakeTime: '07:00', quality: 11 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('stores absent quality and notes as null rather than empty strings', async () => {
    const log = await health.logSleep({ bedtime: '23:00', wakeTime: '07:00', notes: '   ' });
    expect(log.quality).toBeNull();
    expect(log.notes).toBeNull();
  });

  it('keeps a note and a quality when given', async () => {
    const log = await health.logSleep({
      bedtime: '23:00',
      wakeTime: '07:00',
      notes: 'Woke once',
      quality: 7,
    });
    expect(log.notes).toBe('Woke once');
    expect(log.quality).toBe(7);
  });

  it('summarises a range of nights', async () => {
    await health.logSleep({ sleepDate: '2026-01-14', bedtime: '23:00', wakeTime: '07:00' });
    await health.logSleep({ sleepDate: '2026-01-15', bedtime: '00:00', wakeTime: '08:00' });

    const report = await health.sleepReport('2026-01-15', 7);
    expect(report.nights).toBe(2);
    expect(report.averageMinutes).toBe(480);
    // Two nights are not enough for a consistency figure.
    expect(report.consistencyMinutes).toBeNull();
  });

  it('states consistency once three nights are logged', async () => {
    await health.logSleep({ sleepDate: '2026-01-13', bedtime: '23:00', wakeTime: '07:00' });
    await health.logSleep({ sleepDate: '2026-01-14', bedtime: '23:30', wakeTime: '07:00' });
    await health.logSleep({ sleepDate: '2026-01-15', bedtime: '23:00', wakeTime: '08:00' });

    const report = await health.sleepReport('2026-01-15', 7);
    // Durations are 480, 450 and 540 minutes, so the spread is 540 - 450.
    expect(report.consistencyMinutes).toBe(90);
    expect(report.shortestMinutes).toBe(450);
    expect(report.longestMinutes).toBe(540);
  });

  it('excludes nights outside the range', async () => {
    await health.logSleep({ sleepDate: '2025-12-01', bedtime: '23:00', wakeTime: '07:00' });
    await health.logSleep({ sleepDate: '2026-01-15', bedtime: '23:00', wakeTime: '07:00' });

    const report = await health.sleepReport('2026-01-15', 7);
    expect(report.nights).toBe(1);
  });

  it('removes a night and the summary follows', async () => {
    await health.logSleep({ sleepDate: '2026-01-14', bedtime: '23:00', wakeTime: '07:00' });
    const log = await health.logSleep({ sleepDate: '2026-01-15', bedtime: '23:00', wakeTime: '07:00' });

    await health.removeSleep(log.id);

    // Derived from the log on every read, so a deleted night cannot leave a stale total.
    const report = await health.sleepReport('2026-01-15', 7);
    expect(report.nights).toBe(1);
    expect(report.logs[0]?.sleepDate).toBe('2026-01-14');
  });
});
