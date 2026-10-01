import type { Migration } from './types';

/**
 * 001 — Core infrastructure.
 *
 * `app_meta` holds bookkeeping (schema version mirror, install id, first-run stamp).
 * `preferences` is the durable key/value store behind Settings. Values are stored as
 * JSON text so a single table can back strongly typed settings without a migration
 * every time the settings model grows a field.
 */
export const migration001: Migration = {
  version: 1,
  name: 'core',
  statements: [
    `CREATE TABLE app_meta (
       key         TEXT PRIMARY KEY NOT NULL,
       value       TEXT NOT NULL,
       updated_at  INTEGER NOT NULL
     );`,

    `CREATE TABLE preferences (
       key         TEXT PRIMARY KEY NOT NULL,
       value       TEXT NOT NULL,
       updated_at  INTEGER NOT NULL
     );`,

    // Reminders are stored so that they can be re-scheduled after a reboot or an app
    // update without depending on the OS to restore them.
    `CREATE TABLE reminders (
       id           TEXT PRIMARY KEY NOT NULL,
       entity_type  TEXT NOT NULL,
       entity_id    TEXT NOT NULL,
       fire_at      INTEGER NOT NULL,
       cadence      TEXT,
       enabled      INTEGER NOT NULL DEFAULT 1,
       notified_at  INTEGER,
       created_at   INTEGER NOT NULL,
       updated_at   INTEGER NOT NULL,
       CHECK (enabled IN (0, 1))
     );`,

    `CREATE INDEX idx_reminders_fire_at ON reminders (enabled, fire_at);`,
    `CREATE INDEX idx_reminders_entity ON reminders (entity_type, entity_id);`,

    // Audit trail for restores, imports and migrations. Append-only by convention.
    `CREATE TABLE activity_log (
       id           TEXT PRIMARY KEY NOT NULL,
       kind         TEXT NOT NULL,
       entity_type  TEXT,
       entity_id    TEXT,
       detail       TEXT,
       created_at   INTEGER NOT NULL
     );`,

    `CREATE INDEX idx_activity_log_created ON activity_log (created_at DESC);`,
  ],
};
