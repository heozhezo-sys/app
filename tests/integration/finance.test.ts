/**
 * Finance end to end through service -> repository -> real SQLite.
 *
 * The unit tests cover arithmetic on values already in memory. These tests exist because
 * the interesting failures are *relational* and only appear once the schema's own
 * constraints are in play:
 *
 *  1. **A transfer is written as a matched pair, or not at all.** Both legs go in one
 *     transaction. A crash between them would leave money in one account and not the
 *     other with nothing to explain it, so the rollback path is exercised deliberately.
 *  2. **The schema refuses bad money.** Non-positive amounts, mismatched currency and
 *     missing categories are rejected at the storage layer as well as the service, so a
 *     future caller that skips validation still cannot corrupt a ledger.
 *  3. **Deleted legs disappear together.** Deleting one half of a transfer must not leave
 *     an orphan that silently removes the amount from every total.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import {
  __resetDatabaseHandleForTests,
  __setDatabaseHandleForTests,
  getDatabase,
} from '@/database/database';
import { runMigrations } from '@/database/migrator';
import { LATEST_SCHEMA_VERSION } from '@/database/migrations/types';
import * as finance from '@/services/financeService';
import * as repository from '@/repositories/financeRepository';
import { ValidationError } from '@/services/errors';
import { setIdGenerator } from '@/utils/id';
import { transferNetsToZero, type TransferRow } from '@/finance/transfers';

let driver: NodeSqliteDriver;
let now = new Date(2026, 0, 15, 12, 0).getTime();

beforeEach(async () => {
  driver = new NodeSqliteDriver();
  await runMigrations(driver);
  __setDatabaseHandleForTests(driver, LATEST_SCHEMA_VERSION);
  now = new Date(2026, 0, 15, 12, 0).getTime();
  finance.setClock(() => now);
});

afterEach(() => {
  finance.resetClock();
  __resetDatabaseHandleForTests();
});

async function seedAccounts(): Promise<{ checking: string; savings: string }> {
  const checking = await finance.createAccount({
    name: 'Checking',
    type: 'bank',
    currency: 'USD',
    openingBalance: '1000.00',
  });
  const savings = await finance.createAccount({
    name: 'Savings',
    type: 'savings',
    currency: 'USD',
    openingBalance: '500.00',
  });
  return { checking: checking.id, savings: savings.id };
}

async function seedCategories(): Promise<{ food: string; salary: string }> {
  const food = await finance.createCategory({ name: 'Food', kind: 'expense' });
  const salary = await finance.createCategory({ name: 'Salary', kind: 'income' });
  return { food: food.id, salary: salary.id };
}

describe('accounts', () => {
  it('stores the opening balance in minor units, not a float', async () => {
    const { checking } = await seedAccounts();
    const balance = await repository.accountBalance(checking);

    expect(balance.totalMinor).toBe(100_000);
    expect(Number.isInteger(balance.totalMinor)).toBe(true);
  });

  it('accepts a negative opening balance for a credit card', async () => {
    const card = await finance.createAccount({
      name: 'Card',
      type: 'card',
      currency: 'USD',
      openingBalance: '-250.50',
    });
    const balance = await repository.accountBalance(card.id);
    expect(balance.totalMinor).toBe(-25_050);
  });

  it('rejects a malformed amount rather than storing a wrong number', async () => {
    await expect(
      finance.createAccount({
        name: 'Bad',
        type: 'cash',
        currency: 'USD',
        openingBalance: '12.34.56',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an invalid currency code', async () => {
    await expect(
      finance.createAccount({
        name: 'Bad',
        type: 'cash',
        currency: 'DOLLARS',
        openingBalance: '10',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('hides archived accounts from the default list', async () => {
    const { checking } = await seedAccounts();
    await finance.archiveAccount(checking);

    expect(await finance.listAccounts()).toHaveLength(1);
    expect(await finance.listAccounts(true)).toHaveLength(2);
  });
});

describe('transactions', () => {
  it('stores a typed decimal as exact minor units', async () => {
    const { checking } = await seedAccounts();
    const { food } = await seedCategories();

    await finance.recordTransaction({
      accountId: checking,
      categoryId: food,
      kind: 'expense',
      amount: '19.99',
    });

    const balance = await repository.accountBalance(checking);
    // `parseFloat('19.99') * 100` is 1998.9999999999998; this is the reason money is
    // parsed digit by digit from the string.
    expect(balance.expenseMinor).toBe(1999);
  });

  it('accumulates income and expenses into a balance', async () => {
    const { checking } = await seedAccounts();
    const { food, salary } = await seedCategories();

    await finance.recordTransaction({
      accountId: checking,
      categoryId: salary,
      kind: 'income',
      amount: '2000.00',
    });
    await finance.recordTransaction({
      accountId: checking,
      categoryId: food,
      kind: 'expense',
      amount: '250.25',
    });

    const balance = await repository.accountBalance(checking);
    expect(balance.incomeMinor).toBe(200_000);
    expect(balance.expenseMinor).toBe(25_025);
    expect(balance.totalMinor).toBe(274_975);
  });

  it('rejects an expense filed under an income category', async () => {
    const { checking } = await seedAccounts();
    const { salary } = await seedCategories();

    await expect(
      finance.recordTransaction({
        accountId: checking,
        categoryId: salary,
        kind: 'expense',
        amount: '10',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a transaction with no category', async () => {
    // The schema requires a category for anything that is not a transfer.
    const { checking } = await seedAccounts();

    await expect(
      finance.recordTransaction({
        accountId: checking,
        kind: 'expense',
        amount: '10',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a negative amount', async () => {
    const { checking } = await seedAccounts();
    const { food } = await seedCategories();

    await expect(
      finance.recordTransaction({
        accountId: checking,
        categoryId: food,
        kind: 'expense',
        amount: '-10.00',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a non-positive amount at the storage layer too', async () => {
    // Belt and braces: even a caller that bypasses the service cannot write a negative.
    const { checking } = await seedAccounts();
    const { food } = await seedCategories();

    await expect(
      repository.insertTransaction({
        accountId: checking,
        categoryId: food,
        kind: 'expense',
        amountMinor: -100,
        currency: 'USD',
        occurredAt: now,
        payee: null,
        note: null,
      }),
    ).rejects.toBeTruthy();
  });
});


describe('transfers write both legs atomically', () => {
  it('creates a matched pair linked to each other', async () => {
    const { checking, savings } = await seedAccounts();

    const { from, to } = await finance.recordTransfer({
      fromAccountId: checking,
      toAccountId: savings,
      amount: '250.00',
    });

    expect(from.kind).toBe('transfer');
    expect(to.kind).toBe('transfer');
    // The pair invariant: each leg points at the other.
    expect(from.transferPeer).toBe(to.id);
    expect(to.transferPeer).toBe(from.id);
    expect(from.amountMinor).toBe(25_000);
    expect(to.amountMinor).toBe(25_000);
  });

  it('moves the balance without changing the total across accounts', async () => {
    const { checking, savings } = await seedAccounts();

    const totalBefore =
      (await repository.accountBalance(checking)).totalMinor +
      (await repository.accountBalance(savings)).totalMinor;

    await finance.recordTransfer({
      fromAccountId: checking,
      toAccountId: savings,
      amount: '250.00',
    });

    const checkingAfter = (await repository.accountBalance(checking)).totalMinor;
    const savingsAfter = (await repository.accountBalance(savings)).totalMinor;

    expect(checkingAfter).toBe(75_000);
    expect(savingsAfter).toBe(75_000);
    // The invariant that matters most: money moved, none was created or destroyed.
    expect(checkingAfter + savingsAfter).toBe(totalBefore);
  });

  it('leaves no orphan when a leg cannot be written', async () => {
    const { checking, savings } = await seedAccounts();

    // Fail the second insert so the pair is genuinely half-written when the error throws.
    const db = await getDatabase();
    const realRun = db.driver.run.bind(db.driver);
    let inserts = 0;
    db.driver.run = (async (sql: string, params?: readonly unknown[]) => {
      if (sql.includes('INSERT INTO finance_transactions')) {
        inserts += 1;
        if (inserts === 2) throw new Error('simulated storage failure');
      }
      return (realRun as (s: string, p?: readonly unknown[]) => unknown)(sql, params);
    }) as typeof db.driver.run;

    try {
      await expect(
        finance.recordTransfer({
          fromAccountId: checking,
          toAccountId: savings,
          amount: '10.00',
        }),
      ).rejects.toBeTruthy();
    } finally {
      db.driver.run = realRun;
    }

    // The rollback is the point: one leg landed, so without it there would be an orphan
    // worth 1000 that belongs to no balance.
    const rows = await repository.listTransactions({});
    expect(rows.filter((r) => r.kind === 'transfer')).toHaveLength(0);
  });

  it('writes nothing at all when the transfer is invalid', async () => {
    const { checking } = await seedAccounts();

    await expect(
      finance.recordTransfer({
        fromAccountId: checking,
        toAccountId: checking,
        amount: '10.00',
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const rows = await repository.listTransactions({ accountId: checking });
    expect(rows).toHaveLength(0);
  });

  it('rejects a transfer between different currencies', async () => {
    const usd = await finance.createAccount({
      name: 'US',
      type: 'bank',
      currency: 'USD',
      openingBalance: '100',
    });
    const php = await finance.createAccount({
      name: 'PH',
      type: 'bank',
      currency: 'PHP',
      openingBalance: '100',
    });

    await expect(
      finance.recordTransfer({
        fromAccountId: usd.id,
        toAccountId: php.id,
        amount: '100.00',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('deletes both legs together', async () => {
    const { checking, savings } = await seedAccounts();
    const { from } = await finance.recordTransfer({
      fromAccountId: checking,
      toAccountId: savings,
      amount: '250.00',
    });

    await finance.deleteTransaction(from.id);

    const rows = await repository.listTransactions({});
    // An orphan would make the total across accounts wrong forever.
    expect(rows.filter((r) => r.kind === 'transfer')).toHaveLength(0);
    expect((await repository.accountBalance(checking)).totalMinor).toBe(100_000);
    expect((await repository.accountBalance(savings)).totalMinor).toBe(50_000);
  });

  it('always records the outgoing leg with the smaller id', async () => {
    const { checking, savings } = await seedAccounts();

    // Deterministic regression net for a real bug: ids are random UUIDs, so an earlier
    // version that assigned them in call order left the transfer direction — and therefore
    // which account the money left — to chance. This test forces the inverted case by
    // generating descending ids, which is what a full-suite run hit by luck.
    let counter = 0;
    setIdGenerator(() => {
      counter += 1;
      // 'ffffffff-...' first, then descending, so the first generated id is the larger.
      return counter === 1
        ? 'ffffffff-ffff-4fff-8fff-ffffffffffff'
        : '00000000-0000-4000-8000-000000000000';
    });

    try {
      const { from, to } = await finance.recordTransfer({
        fromAccountId: checking,
        toAccountId: savings,
        amount: '10.00',
      });

      // The leg for the *source* account must be the one with the smaller id, or every
      // balance on this pair reads backwards.
      expect(from.id < from.transferPeer!).toBe(true);
      expect(to.id > to.transferPeer!).toBe(true);
      expect((await repository.accountBalance(checking)).totalMinor).toBe(99_000);
      expect((await repository.accountBalance(savings)).totalMinor).toBe(51_000);
    } finally {
      setIdGenerator(null);
    }
  });

  it('keeps every transfer pair netting to zero', async () => {
    const { checking, savings } = await seedAccounts();

    await finance.recordTransfer({ fromAccountId: checking, toAccountId: savings, amount: '10.00' });
    await finance.recordTransfer({ fromAccountId: savings, toAccountId: checking, amount: '3.33' });
    await finance.recordTransfer({ fromAccountId: checking, toAccountId: savings, amount: '0.07' });

    const rows: TransferRow[] = (await repository.listTransactions({})).map((row) => ({
      id: row.id,
      accountId: row.accountId,
      kind: row.kind,
      amountMinor: row.amountMinor,
      currency: row.currency,
      transferPeer: row.transferPeer,
    }));

    expect(rows.filter((r) => r.kind === 'transfer')).toHaveLength(6);
    expect(transferNetsToZero(rows)).toBe(true);
  });
});



describe('budgets', () => {
  it('replaces a budget for the same category and period rather than duplicating it', async () => {
    const { food } = await seedCategories();

    await finance.setBudget({
      categoryId: food,
      periodType: 'monthly',
      amount: '300.00',
      currency: 'USD',
      date: '2026-01-15',
    });
    await finance.setBudget({
      categoryId: food,
      periodType: 'monthly',
      amount: '450.00',
      currency: 'USD',
      date: '2026-01-15',
    });

    const progress = await finance.budgetProgress('monthly', '2026-01-15');
    expect(progress).toHaveLength(1);
    expect(progress[0]?.state.limitMinor).toBe(45_000);
  });

  it('measures spend within the month only', async () => {
    const { checking } = await seedAccounts();
    const { food } = await seedCategories();

    await finance.setBudget({
      categoryId: food,
      periodType: 'monthly',
      amount: '300.00',
      currency: 'USD',
      date: '2026-01-15',
    });

    await finance.recordTransaction({
      accountId: checking,
      categoryId: food,
      kind: 'expense',
      amount: '50.00',
      occurredAt: new Date(2026, 0, 10).getTime(),
    });
    // February spending must not count against January's budget.
    await finance.recordTransaction({
      accountId: checking,
      categoryId: food,
      kind: 'expense',
      amount: '70.00',
      occurredAt: new Date(2026, 1, 2).getTime(),
    });

    // Destructured with a guard rather than `[0]`, so an empty result fails the assertion
    // instead of throwing a confusing "cannot read state of undefined".
    const [january] = await finance.budgetProgress('monthly', '2026-01-15');
    expect(january).toBeDefined();
    expect(january?.state.spentMinor).toBe(5_000);
    expect(january?.state.remainingMinor).toBe(25_000);
  });

  it('reports an overspend rather than clamping to zero', async () => {
    const { checking } = await seedAccounts();
    const { food } = await seedCategories();

    await finance.setBudget({
      categoryId: food,
      periodType: 'monthly',
      amount: '100.00',
      currency: 'USD',
      date: '2026-01-15',
    });
    await finance.recordTransaction({
      accountId: checking,
      categoryId: food,
      kind: 'expense',
      amount: '150.00',
      occurredAt: new Date(2026, 0, 10).getTime(),
    });

    const [state] = await finance.budgetProgress('monthly', '2026-01-15');
    expect(state).toBeDefined();
    expect(state?.state.overBudget).toBe(true);
    expect(state?.state.remainingMinor).toBe(-5_000);
  });

  it('excludes transfers and income from spending', async () => {
    const { checking, savings } = await seedAccounts();
    const { food, salary } = await seedCategories();

    await finance.setBudget({
      categoryId: food,
      periodType: 'monthly',
      amount: '300.00',
      currency: 'USD',
      date: '2026-01-15',
    });
    await finance.recordTransaction({
      accountId: checking,
      categoryId: food,
      kind: 'expense',
      amount: '40.00',
      occurredAt: new Date(2026, 0, 10).getTime(),
    });
    await finance.recordTransaction({
      accountId: checking,
      categoryId: salary,
      kind: 'income',
      amount: '900.00',
      occurredAt: new Date(2026, 0, 10).getTime(),
    });
    await finance.recordTransfer({
      fromAccountId: savings,
      toAccountId: checking,
      amount: '250.00',
      occurredAt: new Date(2026, 0, 11).getTime(),
    });

    const [state] = await finance.budgetProgress('monthly', '2026-01-15');
    expect(state?.state.spentMinor).toBe(4_000);
  });

  it('drops spending when the transaction is deleted', async () => {
    const { checking } = await seedAccounts();
    const { food } = await seedCategories();

    await finance.setBudget({
      categoryId: food,
      periodType: 'monthly',
      amount: '300.00',
      currency: 'USD',
      date: '2026-01-15',
    });
    const created = await finance.recordTransaction({
      accountId: checking,
      categoryId: food,
      kind: 'expense',
      amount: '60.00',
      occurredAt: new Date(2026, 0, 10).getTime(),
    });

    const before = await finance.budgetProgress('monthly', '2026-01-15');
    expect(before[0]?.state.spentMinor).toBe(6_000);

    await finance.deleteTransaction(created.id);
    // Spending is derived on read, so a delete cannot leave a stale total against the limit.
    const after = await finance.budgetProgress('monthly', '2026-01-15');
    expect(after[0]?.state.spentMinor).toBe(0);
  });

  it('separates budgets for different periods', async () => {
    const { food } = await seedCategories();

    await finance.setBudget({
      categoryId: food,
      periodType: 'monthly',
      amount: '300.00',
      currency: 'USD',
      date: '2026-01-15',
    });
    await finance.setBudget({
      categoryId: food,
      periodType: 'yearly',
      amount: '3600.00',
      currency: 'USD',
      date: '2026-01-15',
    });

    expect(await finance.budgetProgress('monthly', '2026-01-15')).toHaveLength(1);
    expect(await finance.budgetProgress('yearly', '2026-01-15')).toHaveLength(1);
  });

describe('period keys and bounds', () => {
  it('keys a monthly budget by year and month', () => {
    expect(finance.budgetPeriodKey('monthly', '2026-01-15')).toBe('2026-01');
    expect(finance.budgetPeriodKey('monthly', '2026-12-31')).toBe('2026-12');
  });

  it('keys a yearly budget by year', () => {
    expect(finance.budgetPeriodKey('yearly', '2026-01-15')).toBe('2026');
  });

  it('covers February correctly in a leap year', () => {
    const { from, to } = finance.periodBounds('monthly', '2024-02-10');
    expect(new Date(from).getDate()).toBe(1);
    expect(new Date(to).getDate()).toBe(29);
  });

  it('covers a non-leap February without spilling into March', () => {
    const { from, to } = finance.periodBounds('monthly', '2026-02-10');
    expect(new Date(from).getDate()).toBe(1);
    expect(new Date(to).getDate()).toBe(28);
    expect(new Date(to).getMonth()).toBe(1);
  });

  it('covers a 31-day month', () => {
    const { to } = finance.periodBounds('monthly', '2026-01-15');
    expect(new Date(to).getDate()).toBe(31);
  });

  it('covers a whole year', () => {
    const { from, to } = finance.periodBounds('yearly', '2026-06-15');
    expect(new Date(from).getMonth()).toBe(0);
    expect(new Date(from).getDate()).toBe(1);
    expect(new Date(to).getMonth()).toBe(11);
    expect(new Date(to).getDate()).toBe(31);
  });

  it('spans exactly seven days for a week, Monday to Sunday', () => {
    const { from, to } = finance.periodBounds('weekly', '2026-01-15');
    expect(new Date(from).getDay()).toBe(1);
    expect(new Date(to).getDay()).toBe(0);
    // Inclusive bounds: six days apart plus the end-of-day offset.
    expect(Math.round((to - from) / 86_400_000)).toBe(7);
  });

  it('keys a weekly budget by ISO week', () => {
    // 2026-01-01 is a Thursday, which belongs to the ISO week starting 2025-12-29.
    expect(finance.budgetPeriodKey('weekly', '2026-01-01')).toBe('2026-W01');
    expect(finance.budgetPeriodKey('weekly', '2026-01-05')).toBe('2026-W02');
  });
});

});
