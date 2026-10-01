import type { Migration } from './types';

/**
 * 011 — Synchronisation outbox.
 *
 * LifeOS is offline-first and has no remote service. This table exists so that a future
 * optional sync is architecturally possible without a destructive schema change: local
 * writes land here, and a transport drains it.
 *
 * `sync_queue` deliberately has no cascade delete. Queued rows reference entities that
 * may themselves be deleted; losing the row would silently drop a pending change, so
 * rows are tombstoned instead and pruned only after a successful push.
 */
export const migration011: Migration = {
  version: 11,
  name: 'sync',
  statements: [
    `CREATE TABLE sync_queue (
       id             TEXT PRIMARY KEY NOT NULL,
       entity_type    TEXT NOT NULL,
       entity_id      TEXT NOT NULL,
       operation      TEXT NOT NULL,
       payload        TEXT NOT NULL,
       state          TEXT NOT NULL DEFAULT 'pending',
       attempt_count  INTEGER NOT NULL DEFAULT 0,
       last_error     TEXT,
       available_at   INTEGER NOT NULL,
       created_at     INTEGER NOT NULL,
       updated_at     INTEGER NOT NULL,
       CHECK (operation IN ('upsert', 'delete')),
       CHECK (state IN ('pending', 'in_flight', 'failed', 'done'))
     );`,

    `CREATE INDEX idx_sync_queue_ready ON sync_queue (state, available_at);`,
    `CREATE INDEX idx_sync_queue_entity ON sync_queue (entity_type, entity_id);`,

    `CREATE TABLE sync_state (
       scope          TEXT PRIMARY KEY NOT NULL,
       cursor         TEXT,
       last_attempt_at INTEGER,
       last_success_at INTEGER,
       status         TEXT NOT NULL DEFAULT 'idle',
       detail         TEXT
     );`,
  ],
};
