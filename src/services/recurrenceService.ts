/**
 * Recurrence use cases: recurring tasks and scheduled money.
 *
 * **Occurrences are created on demand.** When a user opens a day, `ensureTasksFor` creates
 * that day's occurrences for every rule that fires. A daily rule therefore costs one task
 * row per day the user actually visits, not 365 rows a year — which matters because a
 * 10-year daily rule would otherwise be 3650 rows the user never asked for and can no
 * longer meaningfully review.
 *
 * The alternative — materialising a rolling window on launch — was rejected because it
 * still produces rows for days the user may never open, and because it makes "why is this
 * task here?" unanswerable.
 *
 * Completing an occurrence is a normal task completion. That is what makes a recurring
 * habit behave like a habit: the streak logic in `habitsService` sees real rows.
 */

import * as repository from '@/repositories/recurrenceRepository';
import type { RecurringTransaction, TaskRecurrence } from '@/repositories/recurrenceRepository';
import * as tasksRepository from '@/repositories/goalsRepository';
import type { Task } from '@/types/goals';
import { ValidationError } from '@/services/errors';
import type { FieldErrors } from '@/utils/validation';
import { addDays, todayKey, type DateKey } from '@/utils/dates';
import {
  describeRule,
  firesOn,
  nextOccurrence,
  occurrencesInRange,
  validateRule,
  type RecurrenceRule,
} from '@/recurrence/rules';

/* -------------------------------------------------------- recurring tasks */

export interface EnsureResult {
  /** Occurrences created by this call. */
  created: Task[];
  /** How many already existed, so the caller can say "already there". */
  existing: number;
}

/**
 * Creates any task occurrences due on `date`.
 *
 * Idempotent: a task already planned for that day is left alone, so calling this on every
 * render, on every focus, and after every write is safe.
 */
export async function ensureTasksFor(date: DateKey = todayKey()): Promise<EnsureResult> {
  const rules = await repository.listActiveTaskRules(date);
  const created: Task[] = [];
  let existing = 0;

  for (const rule of rules) {
    if (!firesOn(rule.rule, date)) continue;

    const source = await tasksRepository.getTask(rule.taskId);
    if (!source) continue;

    // Already materialised for this day. The lookup is by the rule's own column, so a
    // title edit cannot orphan past occurrences.
    const already = await tasksRepository.findOccurrence(rule.taskId, date);
    if (already) {
      existing += 1;
      continue;
    }

    const occurrence = await tasksRepository.insertTask({
      title: source.title,
      notes: source.notes,
      goalId: source.goalId,
      milestoneId: source.milestoneId,
      priority: source.priority,
      plannedDate: date,
      // Deliberately not copied: the occurrence is its own task with its own deadline.
      // Copying the source's due date would put every occurrence in permanent overdue.
      dueDate: null,
      estimateMin: source.estimateMin,
      recurringFromTaskId: rule.taskId,
    });

    created.push(occurrence);
  }

  return { created, existing };
}

/** Attaches a repeat rule to an existing task. */
export async function makeTaskRepeat(
  taskId: string,
  rule: Omit<RecurrenceRule, 'startDate'> & { startDate?: DateKey },
): Promise<TaskRecurrence> {
  const fields: FieldErrors = {};

  const task = await tasksRepository.getTask(taskId);
  if (!task) fields.taskId = 'That task no longer exists.';

  const resolved: RecurrenceRule = {
    ...rule,
    startDate: rule.startDate ?? todayKey(),
  };

  const ruleError = validateRule(resolved);
  if (ruleError) fields.rule = ruleError;

  if (Object.keys(fields).length > 0) throw new ValidationError(fields);

  // The rule is one-per-task (UNIQUE on task_id), so replacing is the correct semantic
  // for "change how often this repeats" rather than accumulating two rules.
  await repository.deleteTaskRule(taskId);
  return repository.insertTaskRule({ taskId, rule: resolved });
}

/**
 * Stops a task repeating.
 *
 * Removes the rule only. Occurrences already created are ordinary task rows and stay put,
 * so a task the user has not dealt with today is not silently deleted from history.
 */
export async function stopRepeating(taskId: string): Promise<void> {
  await repository.deleteTaskRule(taskId);
}

export async function ruleForTask(taskId: string): Promise<TaskRecurrence | null> {
  return repository.getTaskRule(taskId);
}

/** The next date this rule fires, for the task row's secondary line. */
export function nextDue(rule: RecurrenceRule): DateKey | null {
  return nextOccurrence(rule, todayKey());
}

/** Upcoming firings for a rule, for the schedule editor's preview. */
export function preview(rule: RecurrenceRule, from: DateKey = todayKey(), limit = 5): DateKey[] {
  // A generous horizon so a sparse rule still yields `limit` rows; the scan inside
  // `occurrencesInRange` is bounded independently.
  return occurrencesInRange(rule, from, addDays(from, limit * 40), limit);
}

/** Plain-English summary, e.g. "Every 2 weeks on Mon, Thu". */
export function describe(rule: RecurrenceRule): string {
  return describeRule(rule);
}

/* ------------------------------------------------------- scheduled money */

export interface ScheduledMoneyInput {
  accountId: string;
  categoryId: string;
  kind: 'income' | 'expense';
  /** Major units, e.g. 12.50. Converted to integer minor units here. */
  amount: number;
  currency?: string;
  rule: Omit<RecurrenceRule, 'startDate'> & { startDate?: DateKey };
  payee?: string | null;
  note?: string | null;
}

/**
 * Creates a scheduled transaction.
 *
 * `amount` arrives in major units because that is what a user types, and is converted to
 * integer minor units here — the single place that conversion happens. Money is never
 * stored as a float (ADR-0003).
 */
export async function scheduleMoney(input: ScheduledMoneyInput): Promise<RecurringTransaction> {
  const fields: FieldErrors = {};

  if (!input.accountId) fields.accountId = 'Choose an account.';
  if (!input.categoryId) fields.categoryId = 'Choose a category.';

  const minor = Math.round(input.amount * 100);
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    fields.amount = 'Enter an amount greater than zero.';
  } else if (minor <= 0) {
    // Guards a sub-cent amount, which would otherwise become 0 and violate the
    // `amount_minor > 0` CHECK.
    fields.amount = 'That is less than one cent.';
  }

  const resolved: RecurrenceRule = {
    ...input.rule,
    startDate: input.rule.startDate ?? todayKey(),
  };

  const ruleError = validateRule(resolved);
  if (ruleError) fields.rule = ruleError;

  if (Object.keys(fields).length > 0) throw new ValidationError(fields);

  return repository.insertRecurringTransaction({
    accountId: input.accountId,
    categoryId: input.categoryId,
    kind: input.kind,
    amountMinor: minor,
    currency: input.currency ?? 'USD',
    rule: resolved,
    payee: input.payee?.trim() || null,
    note: input.note?.trim() || null,
  });
}

export async function listScheduled(): Promise<RecurringTransaction[]> {
  return repository.listRecurringTransactions();
}

/** Cancels a schedule. Transactions already posted remain as history. */
export async function cancelScheduled(id: string): Promise<void> {
  await repository.softDeleteRecurringTransaction(id);
}

/**
 * Posts anything due.
 *
 * Called on launch, after a finance write, and on demand from Settings. Idempotent, so
 * calling it repeatedly costs one cheap query per rule.
 */
export async function postDue(today: DateKey = todayKey()) {
  return repository.postDueTransactions(today);
}

/** Next firing for a schedule, for its row. */
export function nextPosting(rule: RecurrenceRule): DateKey | null {
  return nextOccurrence(rule, todayKey());
}

/** Every upcoming firing in a range, for a schedule preview. */
export function upcomingPostings(
  rule: RecurrenceRule,
  from: DateKey,
  to: DateKey,
): DateKey[] {
  return occurrencesInRange(rule, from, to);
}

export { describeRule, firesOn, nextOccurrence, occurrencesInRange, validateRule };
export type { RecurrenceRule, TaskRecurrence };
