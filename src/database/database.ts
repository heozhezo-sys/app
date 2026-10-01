import { ExpoSqlDriver, DATABASE_NAME } from './expoDriver';
import { runMigrations, type MigrationResult } from './migrator';
import { seedReferenceData } from './seed';
import type { SqlDriver } from './driver';
import { logger } from '@/utils/logger';

export interface DatabaseHandle {
  driver: SqlDriver;
  schemaVersion: number;
}

let handle: DatabaseHandle | null = null;
let opening: Promise<DatabaseHandle> | null = null;

/**
 * Change notification bus.
 *
 * Repositories announce writes; hooks subscribe and re-read. This keeps the UI live
 * without a remote-data library: LifeOS is local-only, so "invalidate and re-query"
 * is both sufficient and simpler than cache invalidation over a network.
 *
 * Channels are coarse on purpose (`habits`, `books`, ...). Screens re-read from the
 * database, which is the source of truth, so a coarse notification can never show
 * stale-derived data.
 */
type Channel = string;

type Listener = () => void;

const listeners = new Map<Channel, Set<Listener>>();

export function subscribe(channel: Channel, listener: Listener): () => void {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

export function notify(channel: Channel): void {
  listeners.get(channel)?.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      // A broken subscriber must never break the write that triggered it.
      logger.error(`Database listener for "${channel}" threw`, error);
    }
  });
}

/** Notify several channels at once after a multi-table transaction. */
export function notifyAll(channels: readonly Channel[]): void {
  channels.forEach(notify);
}

export const CHANNELS = {
  habits: 'habits',
  goals: 'goals',
  tasks: 'tasks',
  workouts: 'workouts',
  bodyMetrics: 'body-metrics',
  sports: 'sports',
  books: 'books',
  reading: 'reading',
  focus: 'focus',
  health: 'health',
  nutrition: 'nutrition',
  sleep: 'sleep',
  journal: 'journal',
  finance: 'finance',
  achievements: 'achievements',
  settings: 'settings',
  today: 'today',
} as const;

/**
 * Opens (or returns) the database and brings the schema up to date.
 *
 * Concurrency-safe: simultaneous callers share one in-flight promise, so the app
 * root, a repository and a background task cannot race to migrate.
 */
export function getDatabase(): Promise<DatabaseHandle> {
  if (handle) return Promise.resolve(handle);
  if (opening) return opening;

  opening = (async (): Promise<DatabaseHandle> => {
    const driver = new ExpoSqlDriver(DATABASE_NAME);
    const result: MigrationResult = await runMigrations(driver, {
      onBeforeMigrate: async (from) => {
        if (from > 0) logger.info(`Upgrading database from schema v${from}`);
      },
      onMigrated: async (version, migration) => {
        logger.info(`Applied migration v${version} (${migration.name})`);
      },
    });

    // Reference data is seeded after the schema exists. Idempotent, so it is safe on
    // every launch and safe to interrupt.
    await seedReferenceData(driver);

    const version = await currentSchemaVersion(driver);
    handle = { driver, schemaVersion: version };
    if (result.capabilities.fts5) {
      logger.info('Full-text search available');
    } else {
      logger.warn('Full-text search unavailable on this device; using fallback search');
    }
    return handle;
  })().catch((error: unknown) => {
    opening = null;
    logger.error('Failed to open the database', error);
    throw error;
  });

  return opening;
}

async function currentSchemaVersion(driver: SqlDriver): Promise<number> {
  const row = await driver.first<{ user_version: number }>('PRAGMA user_version;');
  return row?.user_version ?? 0;
}

/** Releases the connection. Used on teardown and by tests. */
export async function closeDatabase(): Promise<void> {
  const current = handle;
  handle = null;
  opening = null;
  if (current) await current.driver.close();
  notifyAll(Object.values(CHANNELS));
}

/** True once the schema is ready. Screens gate rendering on this. */
export function isDatabaseReady(): boolean {
  return handle !== null;
}

/**
 * Test-only seam.
 *
 * Lets an integration test install a real SQLite handle (via `node:sqlite`) so that
 * services and repositories can be exercised end to end without a device. Production
 * code never calls this; `tests/` only.
 */
export function __setDatabaseHandleForTests(driver: SqlDriver, schemaVersion: number): void {
  handle = { driver, schemaVersion };
  opening = Promise.resolve(handle);
}

/** Test-only: drops the installed handle. */
export function __resetDatabaseHandleForTests(): void {
  handle = null;
  opening = null;
}
