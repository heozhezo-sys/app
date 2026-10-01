/**
 * Finance use cases.
 *
 * **No floating-point money, anywhere.** Every amount that reaches storage or leaves this
 * module is an INTEGER number of minor units. The specification forbids unsafe
 * floating-point money, so user input is parsed from the decimal *string* by
 * `parseAmountToMinor` — never through `parseFloat`, because `parseFloat('19.99') * 100`
 * is `1998.9999…`.
 *
 * Validation lives at this boundary so it applies to every caller, not only to screens.
 *
 * A transfer is written as two linked rows in **one transaction**. Building them
 * separately would leave a half-made transfer visible in a balance between the two
 * writes — money appearing in one account and not yet in the other.
 */

import * as repository from '@/repositories/financeRepository';
import type {
  Account,
  AccountType,
  Category,
  CategoryKind,
  Transaction,
  TransactionKind,
} from '@/repositories/financeRepository';
import type { SqlDriver } from '@/database/driver';
import { getDatabase } from '@/database/database';
import { ValidationError } from '@/services/errors';
import type { FieldErrors } from '@/utils/validation';
import { createId } from '@/utils/id';
import { isValidCurrencyCode, parseAmountToMinor } from '@/utils/money';
import { budgetState, spendingByCategory, type BudgetPeriod, type BudgetState } from '@/finance/balances';
import { validateTransfer, type TransferLeg } from '@/finance/transfers';
import {
  addDays,
  isoWeekKey,
  monthKey,
  startOfWeek,
  todayKey,
  yearKey,
  type DateKey,
} from '@/utils/dates';
import { logger } from '@/utils/logger';

/** Injectable clock. Production uses `() => Date.now()`. */
export type Clock = () => number;

let clock: Clock = () => Date.now();

export function setClock(next: Clock): void {
  clock = next;
}

export function resetClock(): void {
  clock = () => Date.now();
}

function now(): number {
  return clock();
}

function today(): DateKey {
  return todayKey(new Date(now()));
}

const MAX_NAME_LENGTH = 80;
/** Guard against a fat-fingered exponent: 100,000,000 major units at two decimals. */
const MAX_MINOR = 10_000_000_000;

function checkName(value: string, field: string, fields: FieldErrors): string {
  const name = (value ?? '').trim();
  if (name === '') fields[field] = 'Give it a name.';
  else if (name.length > MAX_NAME_LENGTH) fields[field] = 'That name is too long.';
  return name;
}

function checkMinor(value: number, field: string, fields: FieldErrors): number {
  if (!Number.isSafeInteger(value)) fields[field] = 'Enter a valid amount.';
  else if (value === 0) fields[field] = 'Enter an amount greater than zero.';
  else if (Math.abs(value) > MAX_MINOR) fields[field] = 'That amount is too large.';
  return value;
}

/* --------------------------------------------------------------- accounts */

export async function createAccount(input: {
  name: string;
  type: AccountType;
  currency: string;
  /** Decimal string from the user; never a float. */
  openingBalance: string;
  openingBalanceDate?: DateKey | null;
}): Promise<Account> {
  const fields: FieldErrors = {};
  const name = checkName(input.name, 'name', fields);
  const currency = input.currency.toUpperCase();

  if (!isValidCurrencyCode(currency)) {
    fields.currency = 'Use a three-letter currency code, such as USD or PHP.';
  }

  const minor = parseAmountToMinor(input.openingBalance ?? '0', currency);
  if (minor === null) {
    fields.openingBalance = 'Enter an amount such as 0 or 1500.50.';
  } else {
    checkMinor(minor, 'openingBalance', fields);
  }

  if (Object.keys(fields).length > 0) throw new ValidationError(fields);

  return repository.insertAccount({
    name,
    type: input.type,
    currency,
    // An opening balance may legitimately be negative: a credit card's debt.
    openingBalanceMinor: minor as number,
    openingBalanceDate: input.openingBalanceDate ?? null,
  });
}

export async function listAccounts(includeArchived = false): Promise<Account[]> {
  return repository.listAccounts(includeArchived);
}

export async function archiveAccount(id: string): Promise<Account | null> {
  return repository.updateAccount(id, { isArchived: true });
}

export async function deleteAccount(id: string): Promise<void> {
  return repository.softDeleteAccount(id);
}

export async function accountBalance(id: string) {
  return repository.accountBalance(id);
}

/* ------------------------------------------------------------- categories */

export async function createCategory(input: {
  name: string;
  kind: CategoryKind;
  colorIndex?: number;
}): Promise<Category> {
  const fields: FieldErrors = {};
  const name = checkName(input.name, 'name', fields);
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);

  return repository.insertCategory({
    name,
    kind: input.kind,
    colorIndex: input.colorIndex ?? 0,
    isSystem: false,
  });
}

export async function listCategories(kind?: CategoryKind): Promise<Category[]> {
  return repository.listCategories(kind);
}

export async function deleteCategory(id: string): Promise<void> {
  return repository.softDeleteCategory(id);
}
/* ----------------------------------------------------------- transactions */

export interface TransactionInput {
  accountId: string;
  categoryId?: string | null;
  kind: Exclude<TransactionKind, 'transfer'>;
  /** Decimal string from the user; never a float. */
  amount: string;
  occurredAt?: number;
  payee?: string | null;
  note?: string | null;
}

/**
 * Records income or an expense.
 *
 * The amount is parsed from the string the user typed and stored as minor units. The
 * transaction inherits its account's currency, so an amount is never interpreted against
 * the wrong one.
 */
export async function recordTransaction(input: TransactionInput): Promise<Transaction> {
  const fields: FieldErrors = {};

  const account = await repository.getAccount(input.accountId);
  if (!account) throw new ValidationError({ accountId: 'Choose an account.' });

  if (input.kind !== 'income' && input.kind !== 'expense') {
    throw new ValidationError({ kind: 'Choose income or expense.' });
  }

  // The schema requires a category for anything that is not a transfer.
  if (!input.categoryId) {
    fields.categoryId = 'Choose a category.';
  } else {
    const category = await repository.getCategory(input.categoryId);
    if (!category) fields.categoryId = 'That category no longer exists.';
    else if (category.kind !== input.kind) {
      // An expense filed under an income category would silently skew every budget and
      // report, so it is rejected rather than tolerated.
      fields.categoryId = `That category is for ${category.kind}, not ${input.kind}.`;
    }
  }

  const minor = parseAmountToMinor(input.amount, account.currency);
  if (minor === null) {
    fields.amount = 'Enter an amount such as 12.50.';
  } else if (minor < 0) {
    // Direction comes from `kind`, not from a sign, so a negative here is a slip. Taking
    // the absolute value would quietly record the opposite of what the user typed, which
    // is the sort of silent correction that erodes trust in a ledger.
    fields.amount = 'Enter a positive amount and choose income or expense.';
  } else {
    checkMinor(minor, 'amount', fields);
  }

  if (Object.keys(fields).length > 0) throw new ValidationError(fields);

  return repository.insertTransaction({
    accountId: account.id,
    categoryId: input.categoryId ?? null,
    kind: input.kind,
    amountMinor: minor as number,
    currency: account.currency,
    occurredAt: input.occurredAt ?? now(),
    payee: input.payee?.trim() || null,
    note: input.note?.trim() || null,
  });
}


/**
 * Moves money between two of the user's own accounts.
 *
 * Both legs are written in one transaction and linked to each other. A half-written
 * transfer would be worse than a failed one: the money would appear in one account and be
 * missing from the other, with no error to explain it.
 */
export async function recordTransfer(input: {
  fromAccountId: string;
  toAccountId: string;
  /** Decimal string from the user; never a float. */
  amount: string;
  occurredAt?: number;
  note?: string | null;
}): Promise<{ from: Transaction; to: Transaction }> {
  const from = await repository.getAccount(input.fromAccountId);
  const to = await repository.getAccount(input.toAccountId);
  if (!from || !to) {
    throw new ValidationError({ accountId: 'Choose two accounts that exist.' });
  }

  const minor = parseAmountToMinor(input.amount, from.currency);
  if (minor === null) throw new ValidationError({ amount: 'Enter an amount such as 100.' });
  if (minor < 0) {
    // A transfer is a single direction by definition, so a negative amount is a slip
    // rather than an instruction, and silently flipping it would move the money the
    // wrong way.
    throw new ValidationError({ amount: 'Enter a positive amount.' });
  }

  const occurredAt = input.occurredAt ?? now();
  const note = input.note?.trim() || null;

  const fromLeg: TransferLeg = {
    accountId: from.id,
    currency: from.currency,
    amountMinor: minor,
    occurredAt,
    note,
  };
  const toLeg: TransferLeg = { ...fromLeg, accountId: to.id, currency: to.currency };

  const rejection = validateTransfer({ from: fromLeg, to: toLeg });
  if (rejection) throw new ValidationError({ [rejection.field]: rejection.message });

  // Ids are generated up front so each leg can reference the other before either is
  // written; the UNIQUE index on `transfer_peer` then holds the pair together.
  //
  // **Ordering matters and is not incidental.** Direction is derived from which id is
  // lexicographically smaller, and ids are random UUIDs — so assigning them in call order
  // would leave the direction to chance, roughly half the time showing the money leaving
  // the *destination* account. Sorting here makes the stored data match the convention by
  // construction. Caught by the integration test once a full-suite run happened to generate
  // an inverted pair.
  const first = createId();
  const second = createId();
  // Written out rather than `.sort()` so both ids stay typed `string`; `noUncheckedIndexedAccess`
  // makes array access `string | undefined`, and a cast here would hide a real mistake.
  const sourceId = first < second ? first : second;
  const targetId = first < second ? second : first;
  const driver = (await getDatabase()).driver;

  await driver.exec('BEGIN;');
  try {
    await insertTransferLeg(driver, {
      id: sourceId,
      accountId: from.id,
      amountMinor: fromLeg.amountMinor,
      currency: from.currency,
      occurredAt,
      peer: targetId,
      note,
    });
    await insertTransferLeg(driver, {
      id: targetId,
      accountId: to.id,
      amountMinor: toLeg.amountMinor,
      currency: to.currency,
      occurredAt,
      peer: sourceId,
      note,
    });
    await driver.exec('COMMIT;');
  } catch (error) {
    // Rolling back leaves both accounts untouched rather than with half a transfer.
    await driver.exec('ROLLBACK;').catch(() => undefined);
    logger.error('Transfer failed; both legs rolled back', error);
    throw error;
  }

  const [source, target] = await Promise.all([
    repository.getTransaction(sourceId),
    repository.getTransaction(targetId),
  ]);
  if (!source || !target) throw new Error('Transfer legs vanished immediately after insert');
  return { from: source, to: target };
}

async function insertTransferLeg(
  driver: SqlDriver,
  input: {
    id: string;
    accountId: string;
    amountMinor: number;
    currency: string;
    occurredAt: number;
    peer: string;
    note: string | null;
  },
): Promise<void> {
  const stamp = Date.now();
  await driver.run(
    `INSERT INTO finance_transactions
       (id, account_id, category_id, kind, amount_minor, currency, occurred_at, payee, note,
        transfer_peer, created_at, updated_at)
     VALUES (?, ?, NULL, 'transfer', ?, ?, ?, NULL, ?, ?, ?, ?);`,
    [
      input.id,
      input.accountId,
      input.amountMinor,
      input.currency,
      input.occurredAt,
      input.note,
      input.peer,
      stamp,
      stamp,
    ],
  );
}

export async function listTransactions(
  options?: Parameters<typeof repository.listTransactions>[0],
): Promise<Transaction[]> {
  return repository.listTransactions(options);
}

/** Deletes a transaction and, for a transfer, its other leg. */
export async function deleteTransaction(id: string): Promise<void> {
  return repository.softDeleteTransaction(id);
}


/* ---------------------------------------------------------------- budgets */

/**
 * The period key for a budget, matching the key a user would recognise.
 *
 * Weekly uses the ISO week, so a budget belongs to the week a person would call "this
 * week" rather than to a row offset that shifts when the year does.
 */
export function budgetPeriodKey(periodType: BudgetPeriod, date: DateKey): string {
  switch (periodType) {
    case 'weekly':
      return isoWeekKey(date);
    case 'yearly':
      return yearKey(date);
    case 'monthly':
    default:
      return monthKey(date);
  }
}

/** Inclusive start and end instants of a budget period, in local time. */
export function periodBounds(periodType: BudgetPeriod, date: DateKey): { from: number; to: number } {
  const [year, month] = date.split('-').map(Number);
  const y = year ?? 1970;
  const m = month ?? 1;

  if (periodType === 'weekly') {
    // ISO weeks start on Monday and span exactly seven days, so the bounds are the same
    // pair of dates every time rather than a computed "last day".
    return dayBounds(startOfWeek(date, 1), addDays(startOfWeek(date, 1), 6));
  }
  if (periodType === 'yearly') {
    return dayBounds(`${y}-01-01`, `${y}-12-31`);
  }

  const mm = String(m).padStart(2, '0');
  // Day 0 of the next month is the last day of this one, so leap years need no special
  // case and February never rolls into March.
  const lastDay = new Date(y, m, 0).getDate();
  return dayBounds(`${y}-${mm}-01`, `${y}-${mm}-${String(lastDay).padStart(2, '0')}`);
}

function dayBounds(from: DateKey, to: DateKey): { from: number; to: number } {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return {
    from: new Date(fy ?? 1970, (fm ?? 1) - 1, fd ?? 1, 0, 0, 0, 0).getTime(),
    to: new Date(ty ?? 1970, (tm ?? 1) - 1, td ?? 1, 23, 59, 59, 999).getTime(),
  };
}

/** Creates or replaces a budget for one category and period. */
export async function setBudget(input: {
  categoryId: string;
  periodType: BudgetPeriod;
  amount: string;
  currency: string;
  /** Defaults to today. */
  date?: DateKey;
}): Promise<{ id: string; amountMinor: number }> {
  const fields: FieldErrors = {};
  const category = await repository.getCategory(input.categoryId);
  if (!category) throw new ValidationError({ categoryId: 'Choose a category.' });

  const minor = parseAmountToMinor(input.amount, input.currency);
  if (minor === null) {
    fields.amount = 'Enter an amount such as 300.';
  } else if (minor < 0) {
    // A negative limit would make every percentage meaningless, so it is refused rather
    // than clamped to zero — the two mean very different things to someone budgeting.
    fields.amount = 'Enter a positive amount.';
  } else {
    checkMinor(minor, 'amount', fields);
  }

  if (Object.keys(fields).length > 0) throw new ValidationError(fields);

  const date = input.date ?? today();
  const budget = await repository.upsertBudget({
    categoryId: input.categoryId,
    periodType: input.periodType,
    periodKey: budgetPeriodKey(input.periodType, date),
    amountMinor: minor as number,
  });

  return { id: budget.id, amountMinor: budget.amountMinor };
}

export interface BudgetProgress {
  categoryId: string;
  periodType: BudgetPeriod;
  periodKey: string;
  state: BudgetState;
}

/**
 * How each budget stands for a period, with spending derived on read.
 *
 * The spent figure is queried rather than stored, so deleting a transaction immediately
 * lowers the spend instead of leaving a stale total against the limit.
 */
export async function budgetProgress(
  periodType: BudgetPeriod,
  date?: DateKey,
): Promise<BudgetProgress[]> {
  const target = date ?? today();
  const key = budgetPeriodKey(periodType, target);
  const { from, to } = periodBounds(periodType, target);

  const budgets = await repository.listBudgets(periodType, key);
  const out: BudgetProgress[] = [];

  for (const budget of budgets) {
    const spent = await repository.spentInCategory(budget.categoryId, from, to);
    out.push({
      categoryId: budget.categoryId,
      periodType,
      periodKey: key,
      state: budgetState(budget.amountMinor, spent),
    });
  }
  return out;
}

export async function deleteBudget(id: string): Promise<void> {
  return repository.softDeleteBudget(id);
}

/**
 * Spending by category for a period, for a breakdown chart.
 *
 * `from` and `to` are date keys; the repository filters on instants, so the inclusive day
 * bounds are computed here. Transactions from every account are included, since a user
 * asking "what did I spend on food" means all of them.
 */
export async function categorySpending(from: DateKey, to: DateKey): Promise<Map<string, number>> {
  const bounds = dayBounds(from, to);
  const transactions = await repository.listTransactions({ from: bounds.from, to: bounds.to, limit: 1000 });

  return spendingByCategory(
    transactions.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      kind: row.kind,
      amountMinor: row.amountMinor,
      currency: row.currency,
      transferPeer: row.transferPeer,
      categoryId: row.categoryId,
    })),
    // An expense whose category was deleted is still money spent, so it is grouped rather
    // than dropped; otherwise the parts would not add up to the total.
    'uncategorised',
  );
}
