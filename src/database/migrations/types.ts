/**
 * Migration contract.
 *
 * Rules that make migrations safe (enforced by tests, not by convention):
 *
 * 1. Versions are integers, strictly increasing, and never reused or edited once
 *    shipped. A released migration is immutable — corrections go in a NEW migration.
 * 2. Every migration runs inside a transaction. `user_version` advances only if the
 *    transaction commits, so an interrupted or failing migration leaves the database
 *    exactly as it was.
 * 3. Migrations are forward-only. A database newer than the binary is refused with a
 *    clear error instead of being downgraded or wiped.
 * 4. Destructive operations are forbidden except via explicit opt-in
 *    `allowDataLoss`, and no migration in this project uses it.
 */

export interface Migration {
  /** Monotonic schema version. Starts at 1. */
  readonly version: number;
  /** Human-readable identifier used in logs and error messages. */
  readonly name: string;
  /** Statements executed in order inside one transaction. */
  readonly statements: readonly string[];
  /**
   * Statements that run only when the named database capability is detected.
   * Used for optional accelerators (FTS5) whose absence must degrade rather than fail.
   */
  readonly when?: {
    readonly capability: 'fts5';
    readonly statements: readonly string[];
  };
  /**
   * Must be `false`. Present only so that a future destructive migration is an
   * explicit, reviewable act rather than an accident.
   */
  readonly allowDataLoss?: false;
}

export const LATEST_SCHEMA_VERSION = 12;
