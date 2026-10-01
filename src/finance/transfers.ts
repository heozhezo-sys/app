/**
 * Transfer pairing and direction.
 *
 * **A schema limitation, handled explicitly.** Migration 009 stores a transfer as two
 * matched rows linked by `transfer_peer`, both with a positive `amount_minor` and both with
 * `kind = 'transfer'`. The migration states that direction is carried by `kind` — but for
 * a transfer, `kind` is identical on both sides, so it carries no direction for *this*
 * account's balance. There is no `direction` or `signed_amount` column.
 *
 * Rather than invent a schema change unilaterally, the direction is derived from data that
 * is already stored and never changes:
 *
 *   **Within a pair, the row with the lexicographically smaller `id` is the source.**
 *   Money leaves that account and arrives at the other's.
 *
 * This is deterministic, stable (ids are immutable), and computable from a single row
 * without loading its peer. It is not obvious to a user reading their ledger, so it is
 * stated here, tested, and recorded as EDGE-0029. **If this ever becomes confusing in
 * practice, the fix is a `direction` column in a new migration — not a subtler ordering
 * rule.**
 */

/** A transaction row reduced to what transfer pairing needs. */
export interface TransferRow {
  id: string;
  accountId: string;
  kind: 'income' | 'expense' | 'transfer';
  amountMinor: number;
  currency: string;
  transferPeer: string | null;
}

/**
 * Whether a transfer row moves money *out of* its account.
 *
 * False for anything that is not a transfer, so a caller can use this without first
 * branching on `kind`.
 */
export function isTransferOut(row: TransferRow): boolean {
  if (row.kind !== 'transfer' || row.transferPeer === null) return false;
  // Strict `<` so a corrupted self-link (`transfer_peer = id`) counts as "out" rather
  // than silently vanishing from a balance.
  return row.id < row.transferPeer;
}

/** True for a row that moves money *into* its account. */
export function isTransferIn(row: TransferRow): boolean {
  if (row.kind !== 'transfer' || row.transferPeer === null) return false;
  return row.id > row.transferPeer;
}

/**
 * A transfer that leaves one account and arrives at another.
 *
 * Both rows are created together and linked to each other. Building them separately would
 * leave a half-made transfer visible in a balance, so this is the only path that creates
 * one.
 */
export interface TransferLeg {
  accountId: string;
  currency: string;
  amountMinor: number;
  occurredAt: number;
  note?: string | null;
}

/**
 * Why a transfer cannot be made.
 *
 * Returned as a value rather than thrown so the screen can attach the message to the right
 * field.
 */
export type TransferRejection =
  | { field: 'amountMinor'; message: string }
  | { field: 'accountId'; message: string }
  | { field: 'accountId'; message: string; kind: 'same-account' | 'currency-mismatch'; from: string; to: string };

/**
 * Validates a transfer before either leg is written.
 *
 * The currency check is the important one: the schema stores one `amount_minor` on both
 * rows and does not check that the two accounts share a currency. Moving "100" from a USD
 * account to a PHP account would silently mean two different amounts, so it is rejected
 * here rather than discovered later in a report.
 */
export function validateTransfer(input: {
  from: TransferLeg;
  to: TransferLeg;
}): TransferRejection | null {
  if (!Number.isSafeInteger(input.from.amountMinor) || input.from.amountMinor <= 0) {
    return { field: 'amountMinor', message: 'Enter an amount greater than zero.' };
  }
  if (input.from.amountMinor !== input.to.amountMinor) {
    // Should be unreachable: both legs are built from one amount. Checked anyway because
    // an unequal pair would make a balance that does not net to zero.
    return { field: 'amountMinor', message: 'Both sides of a transfer must be the same amount.' };
  }
  if (input.from.accountId === input.to.accountId) {
    return {
      field: 'accountId',
      kind: 'same-account',
      message: 'Pick two different accounts.',
      from: input.from.accountId,
      to: input.to.accountId,
    };
  }
  if (input.from.currency !== input.to.currency) {
    return {
      field: 'accountId',
      kind: 'currency-mismatch',
      message: `These accounts use different currencies (${input.from.currency} and ${input.to.currency}).`,
      from: input.from.currency,
      to: input.to.currency,
    };
  }
  return null;
}

/**
 * A transfer nets to zero across the pair, and each account sees one signed amount.
 *
 * A testable statement of the invariant: whatever the convention, the two legs must cancel.
 * If they ever stop cancelling, a user's total across accounts has gained or destroyed
 * money, which is the single most serious bug a finance module can have.
 */
export function transferNetsToZero(rows: readonly TransferRow[]): boolean {
  let total = 0;
  for (const row of rows) {
    if (row.kind !== 'transfer') continue;
    total += isTransferOut(row) ? -row.amountMinor : row.amountMinor;
  }
  return total === 0;
}
