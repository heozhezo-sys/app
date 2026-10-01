/**
 * Balance and budget arithmetic.
 *
 * Every function here takes and returns **integer minor units**. There is no `number` in
 * this file that represents a decimal quantity of currency, and no function accepts a
 * float. `0.1 + 0.2 !== 0.3` in binary floating point; in integers `10 + 20 === 30` always.
 * The specification forbids unsafe floating-point money, and this is where that rule is
 * actually enforced rather than merely restated.
 *
 * Amounts are positive in storage and direction comes from `kind`, which removes an entire
 * family of sign errors from reporting code — a negative budget would otherwise be
 * indistinguishable from a corrupted one.
 */

import { sumMinor } from '@/utils/money';
import { isTransferIn, isTransferOut, type TransferRow } from './transfers';

export type TransactionKind = 'income' | 'expense' | 'transfer';

export interface BalanceInput {
  openingBalanceMinor: number;
  transactions: readonly TransferRow[];
}

export interface BalanceBreakdown {
  incomeMinor: number;
  expenseMinor: number;
  /** Money arriving from another account. */
  transferredInMinor: number;
  /** Money leaving for another account. */
  transferredOutMinor: number;
  /** `opening + income + in - expense - out`. */
  totalMinor: number;
}

/**
 * Breaks an account's balance into its parts and the total.
 *
 * Derived from the transaction list on every read rather than kept as a running balance, so
 * an edited or deleted transaction cannot leave a stale figure behind — the same reasoning
 * used for habit streaks and focus totals.
 */
export function computeBalance(input: BalanceInput): BalanceBreakdown {
  let income = 0;
  let expense = 0;
  let transferredIn = 0;
  let transferredOut = 0;

  for (const row of input.transactions) {
    if (row.kind === 'income') income += row.amountMinor;
    else if (row.kind === 'expense') expense += row.amountMinor;
    else if (isTransferOut(row)) transferredOut += row.amountMinor;
    else if (isTransferIn(row)) transferredIn += row.amountMinor;
    // A transfer row with no peer is neither in nor out. The schema forbids it, so this
    // only guards against corrupt data rather than a real case.
  }

  return {
    incomeMinor: income,
    expenseMinor: expense,
    transferredInMinor: transferredIn,
    transferredOutMinor: transferredOut,
    totalMinor: input.openingBalanceMinor + income + transferredIn - expense - transferredOut,
  };
}

/**
 * Net position across every account.
 *
 * Transfers cancel here by construction, so this is income less expenses plus the sum of
 * opening balances. If a bug ever made a transfer not cancel, this total would be wrong —
 * which is why `transferNetsToZero` is tested separately.
 */
export function netPosition(
  balances: readonly { openingBalanceMinor: number; breakdown: BalanceBreakdown }[],
): number {
  let total = 0;
  for (const account of balances) {
    total += account.openingBalanceMinor + account.breakdown.incomeMinor - account.breakdown.expenseMinor;
  }
  return total;
}

/* ---------------------------------------------------------------- budgets */

export type BudgetPeriod = 'weekly' | 'monthly' | 'yearly';

export interface BudgetState {
  /** The limit set for the period, in minor units. */
  limitMinor: number;
  /** Spent in the period, in minor units. */
  spentMinor: number;
  /** `limit - spent`. Negative means overspent, which is a real state, not an error. */
  remainingMinor: number;
  /** `spent / limit`, rounded to a whole percent. 0 when no limit is set. */
  percentUsed: number;
  overBudget: boolean;
}

/**
 * How a budget stands for a period.
 *
 * The spent figure is supplied by the caller rather than computed here, so this stays a
 * pure function the repository and the tests can share.
 */
export function budgetState(limitMinor: number, spentMinor: number): BudgetState {
  const spent = Math.max(0, spentMinor);
  const limit = Math.max(0, limitMinor);
  const remaining = limit - spent;

  return {
    limitMinor: limit,
    spentMinor: spent,
    remainingMinor: remaining,
    // Integer division then rounding; never a float stored anywhere.
    percentUsed: limit === 0 ? 0 : Math.round((spent / limit) * 100),
    overBudget: limit > 0 && spent > limit,
  };
}

/**
 * Sums expense transactions for a period, ignoring income and transfers.
 *
 * Transfers are excluded deliberately: moving money between the user's own accounts is
 * not spending, and counting it as such would make every budget wrong for anyone who
 * moves money around.
 */
export function spentInPeriod(transactions: readonly TransferRow[]): number {
  return sumMinor(
    transactions
      .filter((row) => row.kind === 'expense')
      .map((row) => row.amountMinor),
  );
}

/**
 * Groups transactions by category for a spending breakdown.
 *
 * Categories with no identifier — a transfer, or an expense whose category was deleted —
 * are grouped under a caller-supplied fallback rather than dropped, so the totals still
 * add up to what the user spent.
 */
export function spendingByCategory(
  transactions: readonly (TransferRow & { categoryId: string | null })[],
  uncategorisedKey: string,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of transactions) {
    if (row.kind !== 'expense') continue;
    const key = row.categoryId ?? uncategorisedKey;
    totals.set(key, (totals.get(key) ?? 0) + row.amountMinor);
  }
  return totals;
}
