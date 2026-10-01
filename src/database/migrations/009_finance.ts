import type { Migration } from './types';

/**
 * 009 — Finance.
 *
 * Money is stored as an INTEGER number of minor units (e.g. cents) together with an
 * ISO-4217 currency code. Floating point is never used: `0.1 + 0.2 !== 0.3` is a bug
 * class that must not exist in someone's ledger.
 *
 * Amounts are always positive; direction is carried by `kind`. This removes an entire
 * family of sign errors from reporting code (a negative budget would otherwise be
 * indistinguishable from a corrupted one).
 */
export const migration009: Migration = {
  version: 9,
  name: 'finance',
  statements: [
    `CREATE TABLE finance_accounts (
       id                    TEXT PRIMARY KEY NOT NULL,
       name                  TEXT NOT NULL,
       type                  TEXT NOT NULL DEFAULT 'cash',
       currency              TEXT NOT NULL DEFAULT 'USD',
       opening_balance_minor INTEGER NOT NULL DEFAULT 0,
       opening_balance_date  TEXT,
       is_archived           INTEGER NOT NULL DEFAULT 0,
       sort_order            INTEGER NOT NULL DEFAULT 0,
       created_at            INTEGER NOT NULL,
       updated_at            INTEGER NOT NULL,
       deleted_at            INTEGER,
       CHECK (type IN ('cash', 'bank', 'card', 'savings', 'investment', 'other')),
       CHECK (length(currency) = 3),
       CHECK (is_archived IN (0, 1))
     );`,

    `CREATE INDEX idx_accounts_archived ON finance_accounts (is_archived, sort_order);`,

    `CREATE TABLE finance_categories (
       id            TEXT PRIMARY KEY NOT NULL,
       name          TEXT NOT NULL,
       kind          TEXT NOT NULL,
       color_index   INTEGER NOT NULL DEFAULT 0,
       parent_id     TEXT,
       is_system     INTEGER NOT NULL DEFAULT 0,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       deleted_at    INTEGER,
       CHECK (kind IN ('income', 'expense')),
       CHECK (is_system IN (0, 1))
     );`,

    `CREATE UNIQUE INDEX idx_categories_name_kind ON finance_categories (name, kind) WHERE deleted_at IS NULL;`,

    `CREATE TABLE finance_transactions (
       id            TEXT PRIMARY KEY NOT NULL,
       account_id    TEXT NOT NULL,
       category_id   TEXT,
       kind          TEXT NOT NULL,
       amount_minor  INTEGER NOT NULL,
       currency      TEXT NOT NULL DEFAULT 'USD',
       occurred_at   INTEGER NOT NULL,
       payee         TEXT,
       note          TEXT,
       transfer_peer TEXT,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       deleted_at    INTEGER,
       CHECK (kind IN ('income', 'expense', 'transfer')),
       -- Non-positive amounts are rejected at the storage layer.
       CHECK (amount_minor > 0),
       CHECK (length(currency) = 3),
       CHECK (category_id IS NOT NULL OR kind = 'transfer'),
       -- A transfer is only meaningful as a matched pair.
       CHECK ((kind = 'transfer') = (transfer_peer IS NOT NULL)),
       FOREIGN KEY (account_id) REFERENCES finance_accounts (id) ON DELETE RESTRICT,
       FOREIGN KEY (category_id) REFERENCES finance_categories (id) ON DELETE SET NULL
     );`,

    `CREATE INDEX idx_transactions_account_date ON finance_transactions (account_id, occurred_at DESC);`,
    `CREATE INDEX idx_transactions_date ON finance_transactions (occurred_at DESC);`,
    `CREATE INDEX idx_transactions_category ON finance_transactions (category_id, occurred_at DESC);`,
    `CREATE UNIQUE INDEX idx_transactions_transfer_peer ON finance_transactions (transfer_peer) WHERE transfer_peer IS NOT NULL AND deleted_at IS NULL;`,

    `CREATE TABLE budgets (
       id            TEXT PRIMARY KEY NOT NULL,
       category_id   TEXT NOT NULL,
       period_type   TEXT NOT NULL DEFAULT 'monthly',
       period_key    TEXT NOT NULL,
       amount_minor  INTEGER NOT NULL,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       deleted_at    INTEGER,
       CHECK (period_type IN ('weekly', 'monthly', 'yearly')),
       CHECK (amount_minor > 0),
       FOREIGN KEY (category_id) REFERENCES finance_categories (id) ON DELETE CASCADE
     );`,

    `CREATE UNIQUE INDEX idx_budgets_period ON budgets (category_id, period_type, period_key) WHERE deleted_at IS NULL;`,
  ],
};
