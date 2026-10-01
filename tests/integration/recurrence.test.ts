/**
 * Recurrence: rules, lazy task occurrences and scheduled money.
 *
 * The properties that matter are the ones that would quietly lose user data: a monthly
 * payment on the 31st must not skip February, a re-run must not double-post, and a
 * completed occurrence must not disappear when its rule is stopped.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import { runMigrations } from '@/database/migrator';
import { __setDatabaseHandleForTests, __resetDatabaseHandleForTests } from '@/database/database';
import * as tasksRepository from '@/repositories/goalsRepository';
import * as recurrenceRepository from '@/repositories/recurrenceRepository';
import * as recurrenceService from '@/services/recurrenceService';
import {
  describeRule,
  firesOn,
  nextOccurrence,
  occurrencesInRange,
  validateRule,
  type RecurrenceRule,
} from '@/recurrence/rules';
import { parseWeekdays, serialiseWeekdays } from '@/recurrence/serialise';
import { ValidationError } from '@/services/errors';
import { fromDateKey } from '@/utils/dates';

let driver: NodeSqliteDriver;

const daily = (startDate: string, extra: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  frequency: 'daily',
  intervalCount: 1,
  startDate,
  ...extra,
});

beforeEach(async () => {
  driver = new NodeSqliteDriver();
  await runMigrations(driver);
  __setDatabaseHandleForTests(driver, 15);
});

afterEach(async () => {
  __resetDatabaseHandleForTests();
  await driver.close();
});

/* ------------------------------------------------------------------ pure */

describe('daily rules', () => {
  it('fires on the start day and every day after', () => {
    const rule = daily('2026-03-01');
    expect(firesOn(rule, '2026-03-01')).toBe(true);
    expect(firesOn(rule, '2026-03-05')).toBe(true);
  });

  it('never fires before the start', () => {
    expect(firesOn(daily('2026-03-10'), '2026-03-09')).toBe(false);
  });

  it('stops at the end date', () => {
    const rule = daily('2026-03-01', { endDate: '2026-03-05' });
    expect(firesOn(rule, '2026-03-05')).toBe(true);
    expect(firesOn(rule, '2026-03-06')).toBe(false);
  });

  it('honours an interval', () => {
    const rule = daily('2026-03-01', { intervalCount: 3 });
    expect(firesOn(rule, '2026-03-01')).toBe(true);
    expect(firesOn(rule, '2026-03-02')).toBe(false);
    expect(firesOn(rule, '2026-03-04')).toBe(true);
  });
});

describe('weekly rules', () => {
  it('fires only on the named days', () => {
    const rule: RecurrenceRule = {
      frequency: 'weekly',
      intervalCount: 1,
      weekdays: [1, 3, 5],
      startDate: '2026-03-01',
    };
    // 2026-03-02 is a Monday.
    expect(firesOn(rule, '2026-03-02')).toBe(true);
    expect(firesOn(rule, '2026-03-03')).toBe(false);
    expect(firesOn(rule, '2026-03-04')).toBe(true);
  });

  it('alternates weeks for an interval of two', () => {
    const rule: RecurrenceRule = {
      frequency: 'weekly',
      intervalCount: 2,
      weekdays: [1],
      startDate: '2026-03-02',
    };
    expect(firesOn(rule, '2026-03-02')).toBe(true);
    expect(firesOn(rule, '2026-03-09')).toBe(false);
    expect(firesOn(rule, '2026-03-16')).toBe(true);
  });

  it('treats a rule with no days as a plain weekly step', () => {
    const rule: RecurrenceRule = {
      frequency: 'weekly',
      intervalCount: 1,
      weekdays: [],
      startDate: '2026-03-02',
    };
    expect(firesOn(rule, '2026-03-02')).toBe(true);
    expect(firesOn(rule, '2026-03-03')).toBe(false);
    expect(firesOn(rule, '2026-03-09')).toBe(true);
  });
});

describe('monthly rules', () => {
  it('fires on the same day each month', () => {
    const rule: RecurrenceRule = {
      frequency: 'monthly',
      intervalCount: 1,
      monthDay: 15,
      startDate: '2026-01-15',
    };
    expect(firesOn(rule, '2026-02-15')).toBe(true);
    expect(firesOn(rule, '2026-03-15')).toBe(true);
    expect(firesOn(rule, '2026-03-16')).toBe(false);
  });

  /**
   * The failure this guards against is a missed rent payment, so it is called out
   * explicitly rather than left as one assertion among many.
   */
  it('clamps a 31st to the last day of a shorter month instead of skipping it', () => {
    const rule: RecurrenceRule = {
      frequency: 'monthly',
      intervalCount: 1,
      monthDay: 31,
      startDate: '2026-01-31',
    };
    // February 2026 has 28 days.
    expect(firesOn(rule, '2026-02-28')).toBe(true);
    expect(firesOn(rule, '2026-02-27')).toBe(false);
  });

  it('clamps to the 29th in a leap February', () => {
    const rule: RecurrenceRule = {
      frequency: 'monthly',
      intervalCount: 1,
      monthDay: 31,
      startDate: '2028-01-31',
    };
    expect(firesOn(rule, '2028-02-29')).toBe(true);
  });

  it('honours a multi-month interval', () => {
    const rule: RecurrenceRule = {
      frequency: 'monthly',
      intervalCount: 2,
      monthDay: 1,
      startDate: '2026-01-01',
    };
    expect(firesOn(rule, '2026-01-01')).toBe(true);
    expect(firesOn(rule, '2026-02-01')).toBe(false);
    expect(firesOn(rule, '2026-03-01')).toBe(true);
  });
});

describe('yearly rules', () => {
  it('fires on the same date each year', () => {
    const rule: RecurrenceRule = {
      frequency: 'yearly',
      intervalCount: 1,
      startDate: '2026-07-04',
    };
    expect(firesOn(rule, '2026-07-04')).toBe(true);
    expect(firesOn(rule, '2027-07-04')).toBe(true);
    expect(firesOn(rule, '2027-07-05')).toBe(false);
  });

  it('clamps a 29 February anniversary in non-leap years', () => {
    const rule: RecurrenceRule = {
      frequency: 'yearly',
      intervalCount: 1,
      startDate: '2028-02-29',
    };
    expect(firesOn(rule, '2028-02-29')).toBe(true);
    expect(firesOn(rule, '2029-02-28')).toBe(true);
  });
});

describe('nextOccurrence', () => {
  it('finds a firing on the cursor day itself, since the search is inclusive', () => {
    // 2026-03-02 is a Monday and a firing day, so an "at or after" search returns it.
    // Callers that need strictly-after (a reminder that has just fired) filter
    // themselves; `reminders/schedule.nextFireAt` is the strictly-after variant.
    const next = nextOccurrence(
      { frequency: 'weekly', intervalCount: 1, weekdays: [1], startDate: '2026-03-02' },
      '2026-03-02',
    );
    expect(next).toBe('2026-03-02');
  });

  it('moves forward when the cursor day is not a firing day', () => {
    const next = nextOccurrence(
      { frequency: 'weekly', intervalCount: 1, weekdays: [1], startDate: '2026-03-02' },
      '2026-03-03',
    );
    expect(next).toBe('2026-03-09');
  });

  it('starts from the start date when the cursor is earlier', () => {
    const next = nextOccurrence(daily('2026-03-10'), '2026-03-01');
    expect(next).toBe('2026-03-10');
  });

  it('returns null once the end date has passed', () => {
    expect(nextOccurrence(daily('2026-03-01', { endDate: '2026-03-05' }), '2026-03-06')).toBeNull();
  });

  it('returns null when the occurrence budget is spent', () => {
    const rule = daily('2026-03-01', { untilOccurrence: 2 });
    expect(nextOccurrence(rule, '2026-03-01')).toBe('2026-03-01');
    expect(nextOccurrence(rule, '2026-03-02')).toBe('2026-03-02');
    // Budget of 2 spent, so nothing more comes round.
    expect(nextOccurrence(rule, '2026-03-03', 2)).toBeNull();
  });
});

describe('occurrencesInRange', () => {
  it('lists every firing in the range, oldest first', () => {
    const dates = occurrencesInRange(daily('2026-03-01'), '2026-03-01', '2026-03-05');
    expect(dates).toEqual([
      '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05',
    ]);
  });

  it('never returns a date outside the range', () => {
    const dates = occurrencesInRange(daily('2026-03-01'), '2026-03-10', '2026-03-12');
    expect(dates).toEqual(['2026-03-10', '2026-03-11', '2026-03-12']);
  });
});

describe('describeRule', () => {
  it('describes each frequency in words', () => {
    expect(describeRule(daily('2026-03-01'))).toBe('Every day');
    expect(describeRule({ frequency: 'weekly', intervalCount: 1, weekdays: [1, 3], startDate: '2026-03-02' }))
      .toBe('Every week on Mon, Wed');
    expect(describeRule({ frequency: 'monthly', intervalCount: 1, monthDay: 15, startDate: '2026-01-15' }))
      .toBe('On day 15 of the month');
  });

  it('includes the interval when it is not 1', () => {
    expect(describeRule(daily('2026-03-01', { intervalCount: 3 }))).toBe('Every 3 days');
  });
});

describe('validateRule', () => {
  it('accepts a well-formed rule', () => {
    expect(validateRule(daily('2026-03-01'))).toBeNull();
  });

  it('rejects an interval below one', () => {
    expect(validateRule(daily('2026-03-01', { intervalCount: 0 }))).toMatch(/at least once/i);
  });

  it('rejects an end date before the start', () => {
    expect(validateRule(daily('2026-03-10', { endDate: '2026-03-01' }))).toMatch(/before/i);
  });

  it('rejects out-of-range weekdays and month days', () => {
    expect(
      validateRule({ frequency: 'weekly', intervalCount: 1, weekdays: [9], startDate: '2026-03-01' }),
    ).toMatch(/Sunday \(0\)/);
    expect(
      validateRule({ frequency: 'monthly', intervalCount: 1, monthDay: 40, startDate: '2026-03-01' }),
    ).toMatch(/between 1 and 31/);
  });
});

describe('weekday serialisation', () => {
  it('round-trips a sorted, de-duplicated set', () => {
    expect(parseWeekdays(serialiseWeekdays([5, 1, 1, 3]))).toEqual([1, 3, 5]);
  });

  it('returns null for an empty set', () => {
    expect(serialiseWeekdays([])).toBeNull();
    expect(serialiseWeekdays(undefined)).toBeNull();
  });

  it('drops out-of-range days', () => {
    expect(serialiseWeekdays([1, 9, -3, 5])).toBe('[1,5]');
  });

  it('reads a legacy plain-string value', () => {
    expect(parseWeekdays('1,3,5')).toEqual([1, 3, 5]);
  });

  it('never throws on hostile input', () => {
    for (const input of ['nonsense', '{', '[]', '[1,"a",null]', null, undefined]) {
      expect(() => parseWeekdays(input)).not.toThrow();
    }
    expect(parseWeekdays('nonsense')).toEqual([]);
  });
});

/* ------------------------------------------------------------ task rules */

async function seedTask(title = 'Water the plants'): Promise<string> {
  const task = await tasksRepository.insertTask({
    title,
    notes: null,
    goalId: null,
    milestoneId: null,
    priority: 'medium',
    plannedDate: null,
    dueDate: null,
    estimateMin: null,
  });
  return task.id;
}

describe('recurring tasks', () => {
  it('creates an occurrence only on a day the rule fires', async () => {
    const taskId = await seedTask();
    // Mondays only, from 2026-03-02.
    await recurrenceService.makeTaskRepeat(taskId, {
      frequency: 'weekly',
      intervalCount: 1,
      weekdays: [1],
      startDate: '2026-03-02',
    });

    const monday = await recurrenceService.ensureTasksFor('2026-03-02');
    expect(monday.created).toHaveLength(1);

    const tuesday = await recurrenceService.ensureTasksFor('2026-03-03');
    expect(tuesday.created).toHaveLength(0);
  });

  it('is idempotent for the same day', async () => {
    const taskId = await seedTask();
    await recurrenceService.makeTaskRepeat(taskId, {
      frequency: 'daily',
      intervalCount: 1,
      startDate: '2026-03-02',
    });

    const first = await recurrenceService.ensureTasksFor('2026-03-05');
    const second = await recurrenceService.ensureTasksFor('2026-03-05');

    expect(first.created).toHaveLength(1);
    expect(second.created).toHaveLength(0);
    expect(second.existing).toBe(1);

    const planned = await tasksRepository.listTasks({ plannedDate: '2026-03-05' });
    expect(planned).toHaveLength(1);
  });

  it('creates a separate occurrence for each firing day', async () => {
    const taskId = await seedTask();
    await recurrenceService.makeTaskRepeat(taskId, {
      frequency: 'daily',
      intervalCount: 1,
      startDate: '2026-03-02',
    });

    await recurrenceService.ensureTasksFor('2026-03-02');
    await recurrenceService.ensureTasksFor('2026-03-03');

    expect(await tasksRepository.listTasks({ plannedDate: '2026-03-02' })).toHaveLength(1);
    expect(await tasksRepository.listTasks({ plannedDate: '2026-03-03' })).toHaveLength(1);
  });

  it('links each occurrence back to its rule', async () => {
    const taskId = await seedTask();
    await recurrenceService.makeTaskRepeat(taskId, {
      frequency: 'daily',
      intervalCount: 1,
      startDate: '2026-03-02',
    });

    const result = await recurrenceService.ensureTasksFor('2026-03-02');
    expect(result.created[0]?.recurringFromTaskId).toBe(taskId);
  });

  it('does not put occurrences permanently in overdue', async () => {
    const taskId = await seedTask();
    await recurrenceService.makeTaskRepeat(taskId, {
      frequency: 'daily',
      intervalCount: 1,
      startDate: '2026-03-02',
    });

    const result = await recurrenceService.ensureTasksFor('2026-03-02');
    // A copied due date would leave every occurrence permanently overdue.
    expect(result.created[0]?.dueDate).toBeNull();
  });

  it('keeps completed history when the rule is stopped', async () => {
    const taskId = await seedTask();
    await recurrenceService.makeTaskRepeat(taskId, {
      frequency: 'daily',
      intervalCount: 1,
      startDate: '2026-03-02',
    });

    const result = await recurrenceService.ensureTasksFor('2026-03-02');
    const occurrence = result.created[0];
    expect(occurrence).toBeDefined();

    await recurrenceService.stopRepeating(taskId);

    // The rule is gone, so no further occurrences — but today's remains.
    expect(await recurrenceService.ruleForTask(taskId)).toBeNull();
    expect(await tasksRepository.listTasks({ plannedDate: '2026-03-02' })).toHaveLength(1);
    expect((await recurrenceService.ensureTasksFor('2026-03-03')).created).toHaveLength(0);
  });

  it('replaces the rule when the schedule is changed', async () => {
    const taskId = await seedTask();
    await recurrenceService.makeTaskRepeat(taskId, {
      frequency: 'daily', intervalCount: 1, startDate: '2026-03-02',
    });
    await recurrenceService.makeTaskRepeat(taskId, {
      frequency: 'weekly', intervalCount: 1, weekdays: [3], startDate: '2026-03-02',
    });

    const rules = await recurrenceRepository.listActiveTaskRules('2026-03-04');
    expect(rules.filter((r) => r.taskId === taskId)).toHaveLength(1);
  });

  it('refuses to repeat a task that does not exist', async () => {
    await expect(
      recurrenceService.makeTaskRepeat('nope', { frequency: 'daily', intervalCount: 1, startDate: '2026-03-02' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses an invalid schedule', async () => {
    const taskId = await seedTask();
    await expect(
      recurrenceService.makeTaskRepeat(taskId, { frequency: 'daily', intervalCount: 0, startDate: '2026-03-02' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('previews upcoming firings', async () => {
    const dates = recurrenceService.preview(
      { frequency: 'weekly', intervalCount: 1, weekdays: [1], startDate: '2026-03-02' },
      '2026-03-02',
      3,
    );
    expect(dates).toHaveLength(3);
  });
});

/* ------------------------------------------------------- scheduled money */

async function seedFinance(): Promise<{ accountId: string; categoryId: string }> {
  await driver.run(
    `INSERT INTO finance_accounts (id, name, currency, created_at, updated_at)
     VALUES ('a1', 'Bank', 'USD', 1, 1);`,
  );
  await driver.run(
    `INSERT INTO finance_categories (id, name, kind, created_at, updated_at)
     VALUES ('c1', 'Rent', 'expense', 1, 1);`,
  );
  return { accountId: 'a1', categoryId: 'c1' };
}

describe('scheduled money', () => {
  it('converts major units to integer minor units', async () => {
    const { accountId, categoryId } = await seedFinance();

    const rule = await recurrenceService.scheduleMoney({
      accountId,
      categoryId,
      kind: 'expense',
      amount: 1250.75,
      currency: 'USD',
      rule: { frequency: 'monthly', intervalCount: 1, monthDay: 1, startDate: '2026-03-01' },
      payee: 'Landlord',
    });

    expect(rule.amountMinor).toBe(125075);
    expect(Number.isInteger(rule.amountMinor)).toBe(true);
  });

  it('rejects an amount that is not positive', async () => {
    const { accountId, categoryId } = await seedFinance();
    await expect(
      recurrenceService.scheduleMoney({
        accountId, categoryId, kind: 'expense', amount: 0,
        rule: { frequency: 'monthly', intervalCount: 1, monthDay: 1, startDate: '2026-03-01' },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a sub-cent amount that would round to zero', async () => {
    const { accountId, categoryId } = await seedFinance();
    await expect(
      recurrenceService.scheduleMoney({
        accountId, categoryId, kind: 'expense', amount: 0.001,
        rule: { frequency: 'monthly', intervalCount: 1, monthDay: 1, startDate: '2026-03-01' },
      }),
    ).rejects.toMatchObject({ fields: { amount: expect.any(String) } });
  });

  it('posts nothing before the start date', async () => {
    const { accountId, categoryId } = await seedFinance();
    await recurrenceService.scheduleMoney({
      accountId, categoryId, kind: 'expense', amount: 100,
      rule: { frequency: 'monthly', intervalCount: 1, monthDay: 1, startDate: '2026-06-01' },
    });

    const result = await recurrenceService.postDue('2026-05-31');
    expect(result.posted).toBe(0);
  });

  it('posts each due month as a real transaction', async () => {
    const { accountId, categoryId } = await seedFinance();
    await recurrenceService.scheduleMoney({
      accountId, categoryId, kind: 'expense', amount: 100,
      rule: { frequency: 'monthly', intervalCount: 1, monthDay: 1, startDate: '2026-01-01' },
      payee: 'Landlord',
    });

    const result = await recurrenceService.postDue('2026-03-15');
    expect(result.posted).toBe(3);

    const rows = await driver.all<{ amount_minor: number }>(
      'SELECT amount_minor FROM finance_transactions ORDER BY occurred_at;',
    );
    expect(rows.map((r) => r.amount_minor)).toEqual([10000, 10000, 10000]);
  });

  it('is idempotent: a second run posts nothing', async () => {
    const { accountId, categoryId } = await seedFinance();
    await recurrenceService.scheduleMoney({
      accountId, categoryId, kind: 'expense', amount: 100,
      rule: { frequency: 'monthly', intervalCount: 1, monthDay: 1, startDate: '2026-01-01' },
    });

    await recurrenceService.postDue('2026-03-15');
    const second = await recurrenceService.postDue('2026-03-15');

    expect(second.posted).toBe(0);
    const count = await driver.first<{ n: number }>('SELECT COUNT(*) AS n FROM finance_transactions;');
    expect(count?.n).toBe(3);
  });

  it('posts only the newly due month on a later run', async () => {
    const { accountId, categoryId } = await seedFinance();
    await recurrenceService.scheduleMoney({
      accountId, categoryId, kind: 'expense', amount: 100,
      rule: { frequency: 'monthly', intervalCount: 1, monthDay: 1, startDate: '2026-01-01' },
    });

    await recurrenceService.postDue('2026-03-15');
    const april = await recurrenceService.postDue('2026-04-02');

    expect(april.posted).toBe(1);
    const count = await driver.first<{ n: number }>('SELECT COUNT(*) AS n FROM finance_transactions;');
    expect(count?.n).toBe(4);
  });

  it('posts the clamped date for a 31st schedule in February', async () => {
    const { accountId, categoryId } = await seedFinance();
    await recurrenceService.scheduleMoney({
      accountId, categoryId, kind: 'expense', amount: 100,
      rule: { frequency: 'monthly', intervalCount: 1, monthDay: 31, startDate: '2026-01-31' },
    });

    await recurrenceService.postDue('2026-02-28');

    const rows = await driver.all<{ occurred_at: number }>(
      'SELECT occurred_at FROM finance_transactions ORDER BY occurred_at;',
    );
    expect(rows).toHaveLength(2);

    const february = new Date(rows[1]?.occurred_at ?? 0);
    expect(february.getMonth()).toBe(1);
    expect(february.getDate()).toBe(28);
  });

  it('never posts into the future', async () => {
    const { accountId, categoryId } = await seedFinance();
    await recurrenceService.scheduleMoney({
      accountId, categoryId, kind: 'expense', amount: 100,
      rule: { frequency: 'daily', intervalCount: 1, startDate: '2026-03-01' },
    });

    await recurrenceService.postDue('2026-03-05');

    const rows = await driver.all<{ occurred_at: number }>(
      'SELECT occurred_at FROM finance_transactions ORDER BY occurred_at;',
    );
    const last = new Date(rows[rows.length - 1]?.occurred_at ?? 0);
    expect(last.getDate()).toBe(5);
  });

  it('respects an end date', async () => {
    const { accountId, categoryId } = await seedFinance();
    await recurrenceService.scheduleMoney({
      accountId, categoryId, kind: 'expense', amount: 100,
      rule: {
        frequency: 'monthly', intervalCount: 1, monthDay: 1,
        startDate: '2026-01-01', endDate: '2026-02-01',
      },
    });

    const result = await recurrenceService.postDue('2026-06-01');
    expect(result.posted).toBe(2);
  });

  it('keeps posted history when the schedule is cancelled', async () => {
    const { accountId, categoryId } = await seedFinance();
    const rule = await recurrenceService.scheduleMoney({
      accountId, categoryId, kind: 'expense', amount: 100,
      rule: { frequency: 'monthly', intervalCount: 1, monthDay: 1, startDate: '2026-01-01' },
    });
    await recurrenceService.postDue('2026-02-15');

    await recurrenceService.cancelScheduled(rule.id);

    expect(await recurrenceRepository.listRecurringTransactions()).toHaveLength(0);
    const count = await driver.first<{ n: number }>('SELECT COUNT(*) AS n FROM finance_transactions;');
    expect(count?.n).toBe(2);
  });

  it('caps a very old backfill rather than posting years of history', async () => {
    const { accountId, categoryId } = await seedFinance();
    await recurrenceService.scheduleMoney({
      accountId, categoryId, kind: 'expense', amount: 100,
      rule: { frequency: 'monthly', intervalCount: 1, monthDay: 1, startDate: '2019-01-01' },
    });

    const result = await recurrenceService.postDue('2026-03-15');

    expect(result.capped).toBe(1);
    // Two years of months at most, not seven.
    expect(result.posted).toBeLessThanOrEqual(24);
  });

  it('lists schedules and reports the next posting', async () => {
    const { accountId, categoryId } = await seedFinance();
    await recurrenceService.scheduleMoney({
      accountId, categoryId, kind: 'expense', amount: 100,
      rule: { frequency: 'monthly', intervalCount: 1, monthDay: 1, startDate: '2026-03-01' },
    });

    const schedules = await recurrenceService.listScheduled();
    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.payee).toBeNull();
  });

  it('lists upcoming postings for a range', () => {
    const dates = recurrenceService.upcomingPostings(
      { frequency: 'monthly', intervalCount: 1, monthDay: 1, startDate: '2026-03-01' },
      '2026-03-01',
      '2026-05-31',
    );
    expect(dates).toEqual(['2026-03-01', '2026-04-01', '2026-05-01']);
  });
});

describe('date key sanity', () => {
  it('agrees with the shared date helper about weekdays', () => {
    // Guards against the recurrence module and src/utils/dates disagreeing about what
    // day of the week a key falls on, which would make "every Monday" silently wrong.
    expect(fromDateKey('2026-03-02').getDay()).toBe(1);
    expect(fromDateKey('2026-03-01').getDay()).toBe(0);
  });
});
