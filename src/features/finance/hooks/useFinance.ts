/**
 * Finance feature hooks.
 *
 * Screens never touch the repository or the service directly; they use these, so the
 * use-case layer stays the one place that knows what a valid amount or transfer is. The
 * screen receives integers and formats them with `formatMinor` — no screen ever holds a
 * decimal quantity of currency as a `number`.
 */

import { useCallback } from 'react';

import { CHANNELS } from '@/database/database';
import { useAction, useAsyncResource } from '@/hooks/useAsyncResource';
import * as service from '@/services/financeService';
import * as rates from '@/services/exchangeRateService';
import type {
  Account,
  Category,
  Transaction,
} from '@/repositories/financeRepository';
import type { BalanceBreakdown, BudgetPeriod, BudgetState } from '@/finance/balances';
import type { BudgetProgress } from '@/services/financeService';
import { todayKey, type DateKey } from '@/utils/dates';

/** Today, from the device clock. */
export function useToday(): DateKey {
  const getToday = useCallback(() => todayKey(new Date()), []);
  return getToday();
}

export function useAccounts(includeArchived = false) {
  return useAsyncResource(
    async () => service.listAccounts(includeArchived),
    CHANNELS.finance,
    { deps: [includeArchived] },
  );
}

/**
 * An account's balance, derived from its transactions on read.
 *
 * Refreshes whenever the finance channel notifies, so an edit elsewhere on the screen is
 * reflected without a manual reload.
 */
/**
 * An account plus its derived balance, for the accounts list.
 *
 * Balances are computed per account rather than stored, so this is a read-time join. The
 * screen must never show a placeholder or a cached figure: a wrong balance is worse than a
 * missing one.
 */
export interface AccountSummary extends Account {
  balance: BalanceBreakdown;
}

export function useAccountSummaries(includeArchived = false) {
  return useAsyncResource(
    async (): Promise<AccountSummary[]> => {
      const accounts = await service.listAccounts(includeArchived);
      // Sequential rather than parallel: SQLite on device is a single connection, and a
      // `Promise.all` over dozens of accounts just queues behind the same writer anyway.
      const out: AccountSummary[] = [];
      for (const account of accounts) {
        out.push({ ...account, balance: await service.accountBalance(account.id) });
      }
      return out;
    },
    CHANNELS.finance,
    { deps: [includeArchived] },
  );
}

export function useAccountBalance(accountId: string | null) {
  return useAsyncResource(
    async () => (accountId ? service.accountBalance(accountId) : null),
    CHANNELS.finance,
    { enabled: accountId !== null, deps: [accountId] },
  );
}

export function useCategories(kind?: 'income' | 'expense') {
  return useAsyncResource(
    async () => service.listCategories(kind),
    CHANNELS.finance,
    { deps: [kind] },
  );
}

export function useTransactions(
  options: { accountId?: string; from?: number; to?: number; limit?: number } = {},
) {
  const { accountId, from, to, limit } = options;
  return useAsyncResource(
    async () => service.listTransactions({ accountId, from, to, limit }),
    CHANNELS.finance,
    { deps: [accountId, from, to, limit] },
  );
}

/** Budget progress for a period, with spending queried rather than stored. */
export function useBudgetProgress(periodType: BudgetPeriod, date: DateKey) {
  return useAsyncResource(
    async () => service.budgetProgress(periodType, date),
    CHANNELS.finance,
    { deps: [periodType, date] },
  );
}

/** Spending grouped by category across every account for a date range. */
export function useCategorySpending(from: DateKey, to: DateKey) {
  return useAsyncResource(
    async () => service.categorySpending(from, to),
    CHANNELS.finance,
    { deps: [from, to] },
  );
}

/* ------------------------------------------------------------- mutations */

export function useCreateAccount() {
  return useAction((input: Parameters<typeof service.createAccount>[0]) =>
    service.createAccount(input),
  );
}

export function useArchiveAccount() {
  return useAction((id: string) => service.archiveAccount(id));
}

export function useCreateCategory() {
  return useAction((input: Parameters<typeof service.createCategory>[0]) =>
    service.createCategory(input),
  );
}

export function useRecordTransaction() {
  return useAction((input: Parameters<typeof service.recordTransaction>[0]) =>
    service.recordTransaction(input),
  );
}

export function useRecordTransfer() {
  return useAction((input: Parameters<typeof service.recordTransfer>[0]) =>
    service.recordTransfer(input),
  );
}

export function useDeleteTransaction() {
  return useAction((id: string) => service.deleteTransaction(id));
}

export function useSetBudget() {
  return useAction((input: Parameters<typeof service.setBudget>[0]) => service.setBudget(input));
}

export function useDeleteBudget() {
  return useAction((id: string) => service.deleteBudget(id));
}

/* --------------------------------------------------------- currencies */

/**
 * User-entered exchange rates, keyed `FROM_TO`.
 *
 * Subscribes to `finance` because a rate change must also refresh any converted total
 * sitting on the same screen — otherwise the number beside an account would keep using
 * the rate that was just replaced.
 */
export function useExchangeRates() {
  return useAsyncResource(() => rates.listRates(), CHANNELS.finance);
}

/**
 * Account balances summed into one currency.
 *
 * Derived on read from the same summaries the accounts list uses, so the converted total
 * and the per-account figures can never disagree.
 */
export function useConvertedTotal(base: string, accounts: readonly AccountSummary[]) {
  return useAsyncResource(
    async () =>
      rates.convertedTotal(
        accounts.map((account) => ({
          minor: account.balance.totalMinor,
          currency: account.currency,
        })),
        base,
      ),
    CHANNELS.finance,
    { deps: [base, accounts] },
  );
}

export function useSetExchangeRate() {
  return useAction((input: Parameters<typeof rates.setRate>[0]) => rates.setRate(input));
}

export function useClearExchangeRate() {
  return useAction(
    (from: string, to: string) => rates.clearRate(from, to),
  );
}

export type { Account, Category, Transaction, BudgetProgress, BudgetState };
export type { ConvertedAmount, ConvertedTotal } from '@/services/exchangeRateService';
