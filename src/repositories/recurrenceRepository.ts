/**
 * Recurrence persistence: task rules and scheduled money.
 *
 * Migration 014 stores a rule in its own row rather than as columns on `tasks` or
 * `finance_transactions`, because a rule must outlive the individual occurrences it
 * generates. That separation is what makes "stop repeating this" (delete the rule) a
 * different, separately auditable act from "skip this one" (delete one occurrence).
 *
 * **Occurrences are materialised lazily.** Nothing here creates rows in advance. Task
 * occurrences appear for days the user visits; scheduled money is posted up to the current
 * day. A daily rule therefore costs a handful of rows rather than 3650.
 */

import type { SqlDriver } from '@/database/driver';
import { getDatabase, notify, CHANNELS } from '@/database/database';
import { createId } from '@/utils/id';
import { serialiseWeekdays, parseWeekdays } from '@/recurrence/serialise';
import { firesOn, type Frequency, type RecurrenceRule } from '@/recurrence/rules';
import { addDays, dateRange, todayKey, type DateKey } from '@/utils/dates';

export interface TaskRecurrence {
  id: string;
  taskId: string;
  rule: RecurrenceRule;
  createdAt: number;
  updatedAt: number;
}

export interface RecurringTransaction {
  id: string;
  accountId: string;
  categoryId: string;
  kind: 'income' | 'expense';
  /** Integer minor units. Never a float — ADR-0003. */
  amountMinor: number;
  currency: string;
  rule: RecurrenceRule;
  /** Last day actually posted, or null if it has never posted. */
  lastPostedDate: DateKey | null;
  payee: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

async function driver(): Promise<SqlDriver> {
  return (await getDatabase()).driver;
}

function announce(): void {
  notify(CHANNELS.tasks);
  notify(CHANNELS.finance);
  notify(CHANNELS.today);
}

/* ------------------------------------------------------------ task rules */

interface TaskRuleRow {
  id: string;
  task_id: string;
  frequency: string;
  interval_count: number;
  weekdays: string | null;
  month_day: number | null;
  start_date: DateKey;
  end_date: DateKey | null;
  until_occurrence: number | null;
  created_at: number;
  updated_at: number;
}

function toTaskRule(row: TaskRuleRow): TaskRecurrence {
  return {
    id: row.id,
    taskId: row.task_id,
    rule: {
      frequency: row.frequency as Frequency,
      intervalCount: row.interval_count,
      ...(row.weekdays ? { weekdays: parseWeekdays(row.weekdays) } : {}),
      ...(row.month_day !== null ? { monthDay: row.month_day } : {}),
      startDate: row.start_date,
      endDate: row.end_date,
      untilOccurrence: row.until_occurrence,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertTaskRule(input: {
  taskId: string;
  rule: RecurrenceRule;
}): Promise<TaskRecurrence> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO task_recurrence
       (id, task_id, frequency, interval_count, weekdays, month_day, start_date,
        end_date, until_occurrence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.taskId,
      input.rule.frequency,
      input.rule.intervalCount,
      serialiseWeekdays(input.rule.weekdays),
      input.rule.monthDay ?? null,
      input.rule.startDate,
      input.rule.endDate ?? null,
      input.rule.untilOccurrence ?? null,
      now,
      now,
    ],
  );

  announce();
  const created = await getTaskRule(input.taskId);
  if (!created) throw new Error(`Task recurrence for ${input.taskId} vanished after insert`);
  return created;
}

export async function getTaskRule(taskId: string): Promise<TaskRecurrence | null> {
  const db = await driver();
  const row = await db.first<TaskRuleRow>(
    'SELECT * FROM task_recurrence WHERE task_id = ? AND deleted_at IS NULL;',
    [taskId],
  );
  return row ? toTaskRule(row) : null;
}

/**
 * Every task rule whose window could still be producing occurrences.
 *
 * Bounded and filtered in SQL so opening the Today screen does not read rules that ended
 * years ago.
 */
export async function listActiveTaskRules(today: DateKey = todayKey()): Promise<TaskRecurrence[]> {
  const db = await driver();
  const rows = await db.all<TaskRuleRow>(
    `SELECT * FROM task_recurrence
      WHERE deleted_at IS NULL
        AND start_date <= ?
        AND (end_date IS NULL OR end_date >= ?)
      ORDER BY start_date ASC;`,
    [today, today],
  );
  return rows.map(toTaskRule);
}

/** Stops a task from repeating. Individual occurrences already created are untouched. */
export async function deleteTaskRule(taskId: string): Promise<void> {
  const db = await driver();
  await db.run('UPDATE task_recurrence SET deleted_at = ?, updated_at = ? WHERE task_id = ?;', [
    Date.now(),
    Date.now(),
    taskId,
  ]);
  announce();
}

export async function countTaskRules(): Promise<number> {
  const db = await driver();
  const row = await db.first<{ n: number | null }>(
    'SELECT COUNT(*) AS n FROM task_recurrence WHERE deleted_at IS NULL;',
  );
  return row?.n ?? 0;
}

/* ---------------------------------------------------- scheduled money */

interface MoneyRuleRow {
  id: string;
  account_id: string;
  category_id: string;
  kind: string;
  amount_minor: number;
  currency: string;
  frequency: string;
  interval_count: number;
  month_day: number | null;
  weekdays: string | null;
  start_date: DateKey;
  end_date: DateKey | null;
  last_posted_date: DateKey | null;
  payee: string | null;
  note: string | null;
  created_at: number;
  updated_at: number;
}

function toMoneyRule(row: MoneyRuleRow): RecurringTransaction {
  return {
    id: row.id,
    accountId: row.account_id,
    categoryId: row.category_id,
    kind: row.kind as 'income' | 'expense',
    amountMinor: row.amount_minor,
    currency: row.currency,
    rule: {
      frequency: row.frequency as Frequency,
      intervalCount: row.interval_count,
      ...(row.weekdays ? { weekdays: parseWeekdays(row.weekdays) } : {}),
      ...(row.month_day !== null ? { monthDay: row.month_day } : {}),
      startDate: row.start_date,
      endDate: row.end_date,
    },
    lastPostedDate: row.last_posted_date,
    payee: row.payee,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertRecurringTransaction(input: {
  accountId: string;
  categoryId: string;
  kind: 'income' | 'expense';
  amountMinor: number;
  currency: string;
  rule: RecurrenceRule;
  payee: string | null;
  note: string | null;
}): Promise<RecurringTransaction> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO recurring_transactions
       (id, account_id, category_id, kind, amount_minor, currency, frequency,
        interval_count, month_day, weekdays, start_date, end_date, payee, note,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.accountId,
      input.categoryId,
      input.kind,
      input.amountMinor,
      input.currency,
      input.rule.frequency,
      input.rule.intervalCount,
      input.rule.monthDay ?? null,
      serialiseWeekdays(input.rule.weekdays),
      input.rule.startDate,
      input.rule.endDate ?? null,
      input.payee,
      input.note,
      now,
      now,
    ],
  );

  announce();
  const created = await getRecurringTransaction(id);
  if (!created) throw new Error(`Recurring transaction ${id} vanished after insert`);
  return created;
}

export async function getRecurringTransaction(id: string): Promise<RecurringTransaction | null> {
  const db = await driver();
  const row = await db.first<MoneyRuleRow>(
    'SELECT * FROM recurring_transactions WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  return row ? toMoneyRule(row) : null;
}

export async function listRecurringTransactions(): Promise<RecurringTransaction[]> {
  const db = await driver();
  const rows = await db.all<MoneyRuleRow>(
    'SELECT * FROM recurring_transactions WHERE deleted_at IS NULL ORDER BY start_date ASC;',
  );
  return rows.map(toMoneyRule);
}

export async function softDeleteRecurringTransaction(id: string): Promise<void> {
  const db = await driver();
  await db.run(
    'UPDATE recurring_transactions SET deleted_at = ?, updated_at = ? WHERE id = ?;',
    [Date.now(), Date.now(), id],
  );
  announce();
}

async function setLastPosted(id: string, date: DateKey): Promise<void> {
  const db = await driver();
  await db.run(
    'UPDATE recurring_transactions SET last_posted_date = ?, updated_at = ? WHERE id = ?;',
    [date, Date.now(), id],
  );
}

/**
 * Posts every scheduled occurrence up to and including `today`.
 *
 * Runs in **one transaction per rule**, and each posting is a real
 * `finance_transactions` row rather than a computed value. That is the whole point: a
 * scheduled payment that only exists as arithmetic cannot be edited, categorised or
 * disputed by the user once it lands (START_DEVELOPMENT_TO_PRODUCTION.md §16).
 *
 * Idempotent by construction. `last_posted_date` advances after each successful post, so
 * calling this twice on the same day posts nothing the second time. A rule that throws
 * mid-run rolls back its own posts and leaves `last_posted_date` untouched, so the next
 * launch retries rather than skipping the month.
 *
 * Backfill is capped at 24 months: a rule created today with a start date in 2019 would
 * otherwise post six years of history in one transaction and surprise the user with a
 * balance they never saw coming.
 */
export async function postDueTransactions(today: DateKey = todayKey()): Promise<{
  posted: number;
  rules: number;
  capped: number;
}> {
  const db = await driver();
  const rules = await listRecurringTransactions();

  let posted = 0;
  let capped = 0;

  for (const rule of rules) {
    // Never post into the future: a scheduled payment is due, not anticipated.
    const horizon = rule.rule.endDate && rule.rule.endDate < today ? rule.rule.endDate : today;

    let cursor: DateKey =
      rule.lastPostedDate ?? (rule.rule.startDate > horizon ? horizon : rule.rule.startDate);

    // Backfill guard: a rule whose start date is years ago must not post years of history
    // in one transaction and surprise the user with a balance they never saw coming. The
    // window is measured back from *today*, not from the start date, which is what
    // actually bounds the work.
    const BACKFILL_DAYS = 730;
    if (rule.lastPostedDate === null) {
      const earliestAllowed = addDays(today, -BACKFILL_DAYS);
      if (cursor < earliestAllowed) {
        cursor = earliestAllowed > rule.rule.startDate ? earliestAllowed : rule.rule.startDate;
        capped += 1;
      }
    }

    const due = dateRange(cursor, horizon).filter((date) => {
      // Never re-post a day this rule already covered. This is what makes the whole
      // function idempotent, including across a restore that reset `last_posted_date`.
      if (rule.lastPostedDate && date <= rule.lastPostedDate) return false;
      return firesOn(rule.rule, date);
    });

    if (due.length === 0) continue;

    await db.transaction(async () => {
      const last = due[due.length - 1];
      for (const date of due) {
        await db.run(
          `INSERT INTO finance_transactions
             (id, account_id, category_id, kind, amount_minor, currency, occurred_at,
              payee, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            createId(),
            rule.accountId,
            rule.categoryId,
            rule.kind,
            rule.amountMinor,
            rule.currency,
            epochAt(date),
            rule.payee,
            rule.note,
            Date.now(),
            Date.now(),
          ],
        );
        posted += 1;
      }
      await setLastPosted(rule.id, last ?? cursor);
    });
  }

  if (posted > 0) announce();
  return { posted, rules: rules.length, capped };
}

/** Epoch ms for local noon on a date, the point a scheduled payment is recorded at. */
function epochAt(date: DateKey): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0).getTime();
}
