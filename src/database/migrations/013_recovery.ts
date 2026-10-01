import type { Migration } from './types';

/**
 * 013 — Recovery.
 *
 * `FEATURES/HEALTH.md` and `FEATURES/RECOVERY.md` both specify energy, soreness, recovery and
 * mood ratings, and mobility/stretching/yoga sessions, but migration 007 only covered
 * hydration, nutrition and sleep. This closes that gap.
 *
 * Ratings are INTEGER 1..10 with the range enforced by CHECK, not only by the service.
 * `FEATURES/RECOVERY.md` is explicit that these are *personal* self-ratings and must never
 * be presented as measurements, so the columns are named `energy`, `soreness` and `mood`
 * rather than anything resembling a clinical vital, and no table here stores a reference
 * range to compare against.
 *
 * `recovery_logs` is UNIQUE on `log_date`: a day's rating is a state you are in, not an
 * event stream you append to. Re-rating a day updates that day's row rather than
 * accumulating contradictory ratings for the same morning.
 *
 * `mobility_sessions` IS an event stream (you may stretch twice a day), so it is not
 * unique on date and carries its own duration in integer minutes.
 */
export const migration013: Migration = {
  version: 13,
  name: 'recovery',
  statements: [
    `CREATE TABLE recovery_logs (
       id           TEXT PRIMARY KEY NOT NULL,
       log_date     TEXT NOT NULL,
       energy       INTEGER,
       soreness     INTEGER,
       recovery     INTEGER,
       mood         INTEGER,
       notes        TEXT,
       logged_at    INTEGER NOT NULL,
       created_at   INTEGER NOT NULL,
       updated_at   INTEGER NOT NULL,
       deleted_at   INTEGER,
       CHECK (log_date LIKE '____-__-__'),
       -- Every rating is nullable: a user may log only their mood.
       CHECK (energy   IS NULL OR (energy   >= 1 AND energy   <= 10)),
       CHECK (soreness IS NULL OR (soreness >= 1 AND soreness <= 10)),
       CHECK (recovery IS NULL OR (recovery >= 1 AND recovery <= 10)),
       CHECK (mood     IS NULL OR (mood     >= 1 AND mood     <= 10))
     );`,

    // One rating set per local day. Re-rating updates in place.
    `CREATE UNIQUE INDEX idx_recovery_logs_date ON recovery_logs (log_date) WHERE deleted_at IS NULL;`,
    `CREATE INDEX idx_recovery_logs_recent ON recovery_logs (log_date DESC, deleted_at);`,

    // Mobility / stretching / yoga. An event stream, so repeated same-day entries are legal.
    `CREATE TABLE mobility_sessions (
       id            TEXT PRIMARY KEY NOT NULL,
       log_date      TEXT NOT NULL,
       kind          TEXT NOT NULL DEFAULT 'mobility',
       title         TEXT,
       duration_min  INTEGER NOT NULL,
       intensity     INTEGER,
       notes         TEXT,
       performed_at  INTEGER NOT NULL,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       deleted_at    INTEGER,
       CHECK (log_date LIKE '____-__-__'),
       CHECK (kind IN ('stretch', 'mobility', 'yoga', 'foam_roll', 'breathing', 'other')),
       CHECK (duration_min > 0),
       CHECK (intensity IS NULL OR (intensity >= 1 AND intensity <= 10))
     );`,

    `CREATE INDEX idx_mobility_date ON mobility_sessions (log_date DESC, deleted_at);`,
    `CREATE INDEX idx_mobility_kind ON mobility_sessions (kind, log_date DESC);`,
  ],
};
