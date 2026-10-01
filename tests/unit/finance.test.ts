/**
 * Finance balance and budget arithmetic.
 *
 * The emphasis here is arithmetic, not screens. Two properties matter more than anything
 * else in this module and each is pinned by a test:
 *
 *  1. **Money is integer minor units.** A single float in a money path corrupts a ledger.
 *  2. **A transfer nets to zero.** If the two legs stop cancelling, a user's total across
 *     accounts has gained or destroyed money — the worst bug a finance module can have.
 *
 * String-to-minor parsing is covered in `money.test.ts`; this file assumes a parsed amount
 * and tests what happens next.
 */

import {
  budgetState,
  computeBalance,
  netPosition,
  spentInPeriod,
  spendingByCategory,
  type BalanceBreakdown,
} from '@/finance/balances';
import {
  isTransferIn,
  isTransferOut,
  transferNetsToZero,
  validateTransfer,
  type TransferRow,
} from '@/finance/transfers';

function row(overrides: Partial<TransferRow> = {}): TransferRow {
  return {
    id: 'a',
    accountId: 'acct-1',
    kind: 'expense',
    amountMinor: 100,
    currency: 'USD',
    transferPeer: null,
    ...overrides,
  };
}

/**
 * A completed transfer pair, source and destination, as the service would write it.
 *
 * Typed as a tuple so destructuring is checked: reading leg 1 as leg 2's partner is the
 * kind of slip these tests exist to catch, and the compiler should catch it too.
 */
function pair(sourceId: string, targetId: string, amountMinor: number): [TransferRow, TransferRow] {
  return [
    row({ id: sourceId, kind: 'transfer', amountMinor, transferPeer: targetId }),
    row({
      id: targetId,
      accountId: 'acct-2',
      kind: 'transfer',
      amountMinor,
      transferPeer: sourceId,
    }),
  ];
}

describe('money arithmetic stays in integers', () => {
  it('sums amounts exactly where floats would not', () => {
    // The classic failure: 0.1 + 0.2 === 0.30000000000000004.
    const total = computeBalance({
      openingBalanceMinor: 0,
      transactions: [
        row({ kind: 'expense', amountMinor: 10 }),
        row({ kind: 'expense', amountMinor: 20 }),
      ],
    });
    expect(total.expenseMinor).toBe(30);
    expect(total.totalMinor).toBe(-30);
  });

  it('never returns a non-integer from any balance figure', () => {
    const rows = [1, 7, 13, 99, 1234].map((minor) => row({ amountMinor: minor }));
    const total = computeBalance({ openingBalanceMinor: 1001, transactions: rows });
    for (const value of Object.values(total)) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});

describe('computeBalance', () => {
  it('adds income and subtracts expenses from the opening balance', () => {
    const total = computeBalance({
      openingBalanceMinor: 10_000,
      transactions: [
        row({ kind: 'income', amountMinor: 50_000 }),
        row({ kind: 'expense', amountMinor: 2_500 }),
      ],
    });

    expect(total.incomeMinor).toBe(50_000);
    expect(total.expenseMinor).toBe(2_500);
    expect(total.totalMinor).toBe(57_500);
  });

  it('allows a negative opening balance for a credit card', () => {
    const total = computeBalance({
      openingBalanceMinor: -25_000,
      transactions: [row({ kind: 'expense', amountMinor: 5_000 })],
    });
    expect(total.totalMinor).toBe(-30_000);
  });
});

describe('transfers', () => {
  it('derives direction so each account sees one signed amount', () => {
    const [source, target] = pair('aaa', 'bbb', 5_000);

    expect(isTransferOut(source)).toBe(true);
    expect(isTransferIn(source)).toBe(false);
    expect(isTransferIn(target)).toBe(true);
    expect(isTransferOut(target)).toBe(false);
  });

  it('nets to zero across the pair', () => {
    expect(transferNetsToZero(pair('aaa', 'bbb', 5_000))).toBe(true);
  });

  it('nets to zero even for many pairs', () => {
    const rows = [
      ...pair('a1', 'b1', 100),
      ...pair('a2', 'b2', 250),
      ...pair('a3', 'b3', 7),
    ];
    expect(transferNetsToZero(rows)).toBe(true);
  });

  it('shows the outflow in the source balance and the inflow in the target', () => {
    const [source, target] = pair('aaa', 'bbb', 5_000);

    const fromBalance = computeBalance({ openingBalanceMinor: 20_000, transactions: [source] });
    const toBalance = computeBalance({ openingBalanceMinor: 0, transactions: [target] });

    expect(fromBalance.transferredOutMinor).toBe(5_000);
    expect(fromBalance.totalMinor).toBe(15_000);
    expect(toBalance.transferredInMinor).toBe(5_000);
    expect(toBalance.totalMinor).toBe(5_000);
    // Money moved, not created or destroyed.
    expect(fromBalance.totalMinor + toBalance.totalMinor).toBe(20_000);
  });

  it('counts a transfer as neither income nor expense', () => {
    const [source] = pair('aaa', 'bbb', 5_000);
    const total = computeBalance({ openingBalanceMinor: 0, transactions: [source] });
    expect(total.incomeMinor).toBe(0);
    expect(total.expenseMinor).toBe(0);
  });

  it('does not let a transfer change the net position across accounts', () => {
    const empty: BalanceBreakdown = {
      incomeMinor: 0,
      expenseMinor: 0,
      transferredInMinor: 0,
      transferredOutMinor: 0,
      totalMinor: 0,
    };
    expect(netPosition([{ openingBalanceMinor: 20_000, breakdown: empty }])).toBe(20_000);

    // After a transfer the sum across both accounts is unchanged.
    const [source, target] = pair('aaa', 'bbb', 5_000);
    const after = netPosition([
      {
        openingBalanceMinor: 20_000,
        breakdown: computeBalance({ openingBalanceMinor: 20_000, transactions: [source] }),
      },
      {
        openingBalanceMinor: 0,
        breakdown: computeBalance({ openingBalanceMinor: 0, transactions: [target] }),
      },
    ]);
    expect(after).toBe(20_000);
  });

  it('rejects a transfer to the same account', () => {
    const rejection = validateTransfer({
      from: { accountId: 'a', currency: 'USD', amountMinor: 100, occurredAt: 0 },
      to: { accountId: 'a', currency: 'USD', amountMinor: 100, occurredAt: 0 },
    });
    expect(rejection).not.toBeNull();
    expect(rejection?.message).toMatch(/two different accounts/i);
  });

  it('rejects a transfer between different currencies', () => {
    // Without this check "100" would silently mean two different amounts.
    const rejection = validateTransfer({
      from: { accountId: 'a', currency: 'USD', amountMinor: 100, occurredAt: 0 },
      to: { accountId: 'b', currency: 'PHP', amountMinor: 100, occurredAt: 0 },
    });
    expect(rejection?.message).toMatch(/USD and PHP/);
  });

  it('rejects a non-positive amount', () => {
    const rejection = validateTransfer({
      from: { accountId: 'a', currency: 'USD', amountMinor: 0, occurredAt: 0 },
      to: { accountId: 'b', currency: 'USD', amountMinor: 0, occurredAt: 0 },
    });
    expect(rejection?.field).toBe('amountMinor');
  });

  it('accepts a valid transfer', () => {
    expect(
      validateTransfer({
        from: { accountId: 'a', currency: 'USD', amountMinor: 100, occurredAt: 0 },
        to: { accountId: 'b', currency: 'USD', amountMinor: 100, occurredAt: 0 },
      }),
    ).toBeNull();
  });
});

describe('budgets', () => {
  it('reports remaining and percentage against the limit', () => {
    const state = budgetState(30_000, 12_000);
    expect(state.remainingMinor).toBe(18_000);
    expect(state.percentUsed).toBe(40);
    expect(state.overBudget).toBe(false);
  });

  it('reports a negative remaining when overspent, rather than clamping', () => {
    const state = budgetState(10_000, 12_500);
    expect(state.remainingMinor).toBe(-2_500);
    expect(state.overBudget).toBe(true);
    expect(state.percentUsed).toBe(125);
  });

  it('treats a zero limit as no budget rather than dividing by zero', () => {
    const state = budgetState(0, 5_000);
    expect(state.percentUsed).toBe(0);
    expect(state.overBudget).toBe(false);
  });

  it('spends exactly with integers', () => {
    // A third of 1000 is 333.33, which floats get wrong; the parts must still sum exactly.
    const total = spentInPeriod([
      row({ amountMinor: 333 }),
      row({ amountMinor: 333 }),
      row({ amountMinor: 334 }),
    ]);
    expect(total).toBe(1000);
    expect(budgetState(1000, total).percentUsed).toBe(100);
  });

  it('excludes income and transfers from spending', () => {
    // Moving money between the user's own accounts is not spending; counting it would make
    // every budget wrong for anyone who moves money around.
    const total = spentInPeriod([
      ...pair('a1', 'b1', 10_000),
      row({ kind: 'income', amountMinor: 50_000 }),
      row({ kind: 'expense', amountMinor: 1_000 }),
    ]);
    expect(total).toBe(1_000);
  });

  it('groups spending by category and keeps uncategorised expenses visible', () => {
    const totals = spendingByCategory(
      [
        { ...row(), categoryId: 'food' },
        { ...row({ amountMinor: 250 }), categoryId: 'food' },
        { ...row({ amountMinor: 500 }), categoryId: null },
      ],
      'uncategorised',
    );

    expect(totals.get('food')).toBe(350);
    // Deleted categories must not make the parts fail to add up to the total.
    expect(totals.get('uncategorised')).toBe(500);
  });
});

