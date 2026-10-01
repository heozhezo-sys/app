/**
 * Finance persistence.
 *
 * Money is INTEGER minor units plus an ISO-4217 currency code. No float column exists in
 * this schema and no function here accepts or returns a decimal quantity of currency.
 *
 * Amounts are always **positive**; direction comes from `kind`. That is why a balance is
 * never a sum of signed numbers here, and why an over-budget figure is unambiguously
 * "spent more than allowed" rather than "a negative budget".
 *
 * A transfer is two matched rows, both positive. See `src/finance/transfers.ts` for the
 * direction convention and why it exists.
 */

import type { SqlDriver, SqlValue } from '@/database/driver';
import { getDatabase, notify, CHANNELS } from '@/database/database';
import { createId } from '@/utils/id';
import { computeBalance, spentInPeriod, type BalanceBreakdown, type BudgetPeriod } from '@/finance/balances';
import type { TransferRow } from '@/finance/transfers';

export type AccountType = 'cash' | 'bank' | 'card' | 'savings' | 'investment' | 'other';
export type CategoryKind = 'income' | 'expense';
export type TransactionKind = 'income' | 'expense' | 'transfer';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  openingBalanceMinor: number;
  openingBalanceDate: string | null;
  isArchived: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  colorIndex: number;
  parentId: string | null;
  isSystem: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Transaction {
  id: string;
  accountId: string;
  categoryId: string | null;
  kind: TransactionKind;
  amountMinor: number;
  currency: string;
  occurredAt: number;
  payee: string | null;
  note: string | null;
  transferPeer: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Budget {
  id: string;
  categoryId: string;
  periodType: BudgetPeriod;
  periodKey: string;
  amountMinor: number;
  createdAt: number;
  updatedAt: number;
}

async function driver(): Promise<SqlDriver> {
  return (await getDatabase()).driver;
}

function announce(): void {
  notify(CHANNELS.finance);
  notify(CHANNELS.today);
}

/* --------------------------------------------------------------- accounts */

interface AccountRow {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  opening_balance_minor: number;
  opening_balance_date: string | null;
  is_archived: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    openingBalanceMinor: row.opening_balance_minor,
    openingBalanceDate: row.opening_balance_date,
    isArchived: row.is_archived === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertAccount(input: {
  name: string;
  type: AccountType;
  currency: string;
  openingBalanceMinor: number;
  openingBalanceDate: string | null;
}): Promise<Account> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO finance_accounts
       (id, name, type, currency, opening_balance_minor, opening_balance_date, sort_order,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.name,
      input.type,
      input.currency.toUpperCase(),
      input.openingBalanceMinor,
      input.openingBalanceDate,
      // New accounts sort after the seeded defaults.
      1000,
      now,
      now,
    ],
  );

  announce();
  const created = await getAccount(id);
  if (!created) throw new Error(`Account ${id} vanished immediately after insert`);
  return created;
}

export async function getAccount(id: string): Promise<Account | null> {
  const db = await driver();
  const row = await db.first<AccountRow>(
    'SELECT * FROM finance_accounts WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  return row ? toAccount(row) : null;
}

export async function listAccounts(includeArchived = false): Promise<Account[]> {
  const db = await driver();
  const rows = await db.all<AccountRow>(
    `SELECT * FROM finance_accounts
      WHERE deleted_at IS NULL ${includeArchived ? '' : 'AND is_archived = 0'}
      ORDER BY sort_order ASC, created_at ASC;`,
  );
  return rows.map(toAccount);
}

export async function updateAccount(
  id: string,
  patch: Partial<{
    name: string;
    type: AccountType;
    openingBalanceMinor: number;
    openingBalanceDate: string | null;
    isArchived: boolean;
    sortOrder: number;
  }>,
): Promise<Account | null> {
  const db = await driver();
  const columns: string[] = [];
  const params: SqlValue[] = [];

  const set = (column: string, value: SqlValue): void => {
    columns.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.name !== undefined) set('name', patch.name);
  if (patch.type !== undefined) set('type', patch.type);
  if (patch.openingBalanceMinor !== undefined) {
    set('opening_balance_minor', patch.openingBalanceMinor);
  }
  if (patch.openingBalanceDate !== undefined) {
    set('opening_balance_date', patch.openingBalanceDate);
  }
  if (patch.isArchived !== undefined) set('is_archived', patch.isArchived ? 1 : 0);
  if (patch.sortOrder !== undefined) set('sort_order', patch.sortOrder);

  if (columns.length === 0) return getAccount(id);

  set('updated_at', Date.now());
  params.push(id);
  await db.run(
    `UPDATE finance_accounts SET ${columns.join(', ')} WHERE id = ? AND deleted_at IS NULL;`,
    params,
  );
  announce();
  return getAccount(id);
}

export async function softDeleteAccount(id: string): Promise<void> {
  const db = await driver();
  await db.run('UPDATE finance_accounts SET deleted_at = ? WHERE id = ?;', [Date.now(), id]);
  announce();
}
/* ------------------------------------------------------------- categories */

interface CategoryRow {
  id: string;
  name: string;
  kind: CategoryKind;
  color_index: number;
  parent_id: string | null;
  is_system: number;
  created_at: number;
  updated_at: number;
}

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    colorIndex: row.color_index,
    parentId: row.parent_id,
    isSystem: row.is_system === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Inserts a category.
 *
 * A partial UNIQUE index on `(name, kind)` means the same name cannot exist twice for the
 * same kind, which is the constraint a user would expect ("Salary" once under income).
 */
export async function insertCategory(input: {
  name: string;
  kind: CategoryKind;
  colorIndex: number;
  isSystem: boolean;
}): Promise<Category> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO finance_categories
       (id, name, kind, color_index, is_system, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [id, input.name, input.kind, input.colorIndex, input.isSystem ? 1 : 0, now, now],
  );

  announce();
  const created = await getCategory(id);
  if (!created) throw new Error(`Category ${id} vanished immediately after insert`);
  return created;
}

export async function getCategory(id: string): Promise<Category | null> {
  const db = await driver();
  const row = await db.first<CategoryRow>(
    'SELECT * FROM finance_categories WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  return row ? toCategory(row) : null;
}

export async function listCategories(kind?: CategoryKind): Promise<Category[]> {
  const db = await driver();
  const rows = kind
    ? await db.all<CategoryRow>(
        'SELECT * FROM finance_categories WHERE deleted_at IS NULL AND kind = ? ORDER BY name ASC;',
        [kind],
      )
    : await db.all<CategoryRow>(
        'SELECT * FROM finance_categories WHERE deleted_at IS NULL ORDER BY kind ASC, name ASC;',
      );
  return rows.map(toCategory);
}

export async function softDeleteCategory(id: string): Promise<void> {
  const db = await driver();
  // Soft rather than hard delete: `finance_transactions.category_id` is
  // `ON DELETE SET NULL`, so a hard delete would silently un-categorise a user's history.
  await db.run('UPDATE finance_categories SET deleted_at = ? WHERE id = ?;', [Date.now(), id]);
  announce();
}

/* ----------------------------------------------------------- transactions */

interface TransactionRow {
  id: string;
  account_id: string;
  category_id: string | null;
  kind: TransactionKind;
  amount_minor: number;
  currency: string;
  occurred_at: number;
  payee: string | null;
  note: string | null;
  transfer_peer: string | null;
  created_at: number;
  updated_at: number;
}

function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    accountId: row.account_id,
    categoryId: row.category_id,
    kind: row.kind,
    amountMinor: row.amount_minor,
    currency: row.currency,
    occurredAt: row.occurred_at,
    payee: row.payee,
    note: row.note,
    transferPeer: row.transfer_peer,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertTransaction(input: {
  accountId: string;
  categoryId: string | null;
  kind: TransactionKind;
  amountMinor: number;
  currency: string;
  occurredAt: number;
  payee: string | null;
  note: string | null;
  transferPeer?: string | null;
}): Promise<Transaction> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO finance_transactions
       (id, account_id, category_id, kind, amount_minor, currency, occurred_at, payee, note,
        transfer_peer, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.accountId,
      input.categoryId,
      input.kind,
      input.amountMinor,
      input.currency.toUpperCase(),
      input.occurredAt,
      input.payee,
      input.note,
      input.transferPeer ?? null,
      now,
      now,
    ],
  );

  announce();
  const created = await getTransaction(id);
  if (!created) throw new Error(`Transaction ${id} vanished immediately after insert`);
  return created;
}

export async function getTransaction(id: string): Promise<Transaction | null> {
  const db = await driver();
  const row = await db.first<TransactionRow>(
    'SELECT * FROM finance_transactions WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  return row ? toTransaction(row) : null;
}

export async function listTransactions(
  options: { accountId?: string; from?: number; to?: number; limit?: number } = {},
): Promise<Transaction[]> {
  const db = await driver();
  const limit = Math.min(Math.max(1, options.limit ?? 100), 1000);
  const a = options.accountId ?? null;
  const from = options.from ?? null;
  const to = options.to ?? null;

  const rows = await db.all<TransactionRow>(
    `SELECT * FROM finance_transactions
      WHERE deleted_at IS NULL
        AND (? IS NULL OR account_id = ?)
        AND (? IS NULL OR occurred_at >= ?)
        AND (? IS NULL OR occurred_at <= ?)
      ORDER BY occurred_at DESC, created_at DESC
      LIMIT ?;`,
    [a, a, from, from, to, to, limit],
  );
  return rows.map(toTransaction);
}

/**
 * Deletes a transaction and, for a transfer, its other leg.
 *
 * Leaving one leg behind would break the pair invariant: an orphaned transfer row has no
 * peer, contributes to no balance, and the money would silently vanish from the total.
 */
export async function softDeleteTransaction(id: string): Promise<void> {
  const db = await driver();
  const row = await db.first<{ transfer_peer: string | null }>(
    'SELECT transfer_peer FROM finance_transactions WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  const now = Date.now();

  if (row?.transfer_peer) {
    await db.run('UPDATE finance_transactions SET deleted_at = ? WHERE id IN (?, ?);', [
      now,
      id,
      row.transfer_peer,
    ]);
  } else {
    await db.run('UPDATE finance_transactions SET deleted_at = ? WHERE id = ?;', [now, id]);
  }
  announce();
}

/** Non-deleted transactions for an account, reduced to what balance maths needs. */
export async function listAccountRows(accountId: string): Promise<TransferRow[]> {
  const db = await driver();
  const rows = await db.all<TransactionRow>(
    'SELECT * FROM finance_transactions WHERE account_id = ? AND deleted_at IS NULL;',
    [accountId],
  );
  return rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    kind: row.kind,
    amountMinor: row.amount_minor,
    currency: row.currency,
    transferPeer: row.transfer_peer,
  }));
}

/** An account's balance, derived from its transactions on every read. */
export async function accountBalance(accountId: string): Promise<BalanceBreakdown> {
  const account = await getAccount(accountId);
  if (!account) {
    return {
      incomeMinor: 0,
      expenseMinor: 0,
      transferredInMinor: 0,
      transferredOutMinor: 0,
      totalMinor: 0,
    };
  }
  return computeBalance({
    openingBalanceMinor: account.openingBalanceMinor,
    transactions: await listAccountRows(accountId),
  });
}

/* ---------------------------------------------------------------- budgets */

interface BudgetRow {
  id: string;
  category_id: string;
  period_type: BudgetPeriod;
  period_key: string;
  amount_minor: number;
  created_at: number;
  updated_at: number;
}

function toBudget(row: BudgetRow): Budget {
  return {
    id: row.id,
    categoryId: row.category_id,
    periodType: row.period_type,
    periodKey: row.period_key,
    amountMinor: row.amount_minor,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Creates or replaces a budget for one category and period.
 *
 * One budget per category per period is the useful shape — a monthly food budget is
 * edited in place — and a partial UNIQUE index enforces it. `upsert` means a second save
 * replaces rather than silently creating a duplicate the user cannot see.
 */
export async function upsertBudget(input: {
  categoryId: string;
  periodType: BudgetPeriod;
  periodKey: string;
  amountMinor: number;
}): Promise<Budget> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO budgets
       (id, category_id, period_type, period_key, amount_minor, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (category_id, period_type, period_key) WHERE deleted_at IS NULL
     DO UPDATE SET amount_minor = excluded.amount_minor, updated_at = excluded.updated_at;`,
    [id, input.categoryId, input.periodType, input.periodKey, input.amountMinor, now, now],
  );

  announce();
  const rows = await db.all<BudgetRow>(
    `SELECT * FROM budgets
      WHERE category_id = ? AND period_type = ? AND period_key = ? AND deleted_at IS NULL;`,
    [input.categoryId, input.periodType, input.periodKey],
  );
  const row = rows[0];
  if (!row) throw new Error('Budget vanished immediately after upsert');
  return toBudget(row);
}

export async function listBudgets(
  periodType?: BudgetPeriod,
  periodKey?: string,
): Promise<Budget[]> {
  const db = await driver();
  const type = periodType ?? null;
  const key = periodKey ?? null;

  const rows = await db.all<BudgetRow>(
    `SELECT * FROM budgets
      WHERE deleted_at IS NULL
        AND (? IS NULL OR period_type = ?)
        AND (? IS NULL OR period_key = ?)
      ORDER BY period_key DESC, category_id ASC;`,
    [type, type, key, key],
  );
  return rows.map(toBudget);
}

export async function softDeleteBudget(id: string): Promise<void> {
  const db = await driver();
  await db.run('UPDATE budgets SET deleted_at = ? WHERE id = ?;', [Date.now(), id]);
  announce();
}

/** Expenses in a category between two instants, for budget progress. */
export async function spentInCategory(
  categoryId: string,
  from: number,
  to: number,
): Promise<number> {
  const db = await driver();
  const rows = await db.all<TransactionRow>(
    `SELECT * FROM finance_transactions
      WHERE deleted_at IS NULL AND kind = 'expense' AND category_id = ?
        AND occurred_at >= ? AND occurred_at <= ?;`,
    [categoryId, from, to],
  );
  return spentInPeriod(
    rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      kind: row.kind,
      amountMinor: row.amount_minor,
      currency: row.currency,
      transferPeer: row.transfer_peer,
    })),
  );
}
