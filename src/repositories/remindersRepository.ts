/**
 * Reminder persistence.
 *
 * Migration 001 created `reminders` with the comment "stored so that they can be
 * re-scheduled after a reboot or an app update without depending on the OS to restore
 * them." This repository is the reason that comment is true.
 *
 * The local table is the **source of truth**; the OS's pending-alarm queue is a cache.
 * Both Android (reboot) and iOS (update) clear scheduled notifications without telling
 * the app, so nothing may exist only in the OS.
 *
 * `notified_at` records that a one-shot reminder has already fired, so a reschedule pass
 * does not resurrect a reminder whose moment has passed.
 */

import type { SqlDriver } from '@/database/driver';
import { getDatabase, notify, CHANNELS } from '@/database/database';
import { createId } from '@/utils/id';
import type { ReminderCadence, ReminderTarget } from '@/reminders/schedule';

export interface Reminder {
  id: string;
  entityType: ReminderTarget;
  entityId: string;
  /** Epoch ms of the next fire. */
  fireAt: number;
  cadence: ReminderCadence | null;
  enabled: boolean;
  notifiedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * The text a reminder shows.
 *
 * Stored beside the reminder rather than looked up from the entity, because the point of
 * a reminder is that it is already meaningful when the app is closed — re-deriving "Read
 * 20 pages" from a habit record at fire time would require opening the database from a
 * background context, which is exactly what a local notification must not do.
 */
export interface ReminderWithText extends Reminder {
  title: string;
  body: string;
}

interface ReminderRow {
  id: string;
  entity_type: ReminderTarget;
  entity_id: string;
  fire_at: number;
  cadence: string | null;
  enabled: number;
  notified_at: number | null;
  created_at: number;
  updated_at: number;
  title?: string;
  body?: string;
}

function toReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    fireAt: row.fire_at,
    cadence: (row.cadence as ReminderCadence | null) ?? null,
    enabled: row.enabled === 1,
    notifiedAt: row.notified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toReminderWithText(row: ReminderRow): ReminderWithText {
  return {
    ...toReminder(row),
    title: row.title ?? '',
    body: row.body ?? '',
  };
}

async function driver(): Promise<SqlDriver> {
  return (await getDatabase()).driver;
}

function announce(): void {
  notify(CHANNELS.settings);
  notify(CHANNELS.today);
}

export async function insertReminder(input: {
  entityType: ReminderTarget;
  entityId: string;
  fireAt: number;
  cadence: ReminderCadence | null;
  title: string;
  body: string;
}): Promise<ReminderWithText> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO reminders
       (id, entity_type, entity_id, fire_at, cadence, enabled, created_at, updated_at, title, body)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?);`,
    [id, input.entityType, input.entityId, input.fireAt, input.cadence, now, now, input.title, input.body],
  );

  announce();
  const created = await getReminder(id);
  if (!created) throw new Error(`Reminder ${id} vanished immediately after insert`);
  return created;
}

export async function getReminder(id: string): Promise<ReminderWithText | null> {
  const db = await driver();
  const row = await db.first<ReminderRow>('SELECT * FROM reminders WHERE id = ?;', [id]);
  return row ? toReminderWithText(row) : null;
}

/**
 * Reminders that are enabled, not yet fired, and still in the future.
 *
 * This is exactly the set that needs to exist in the OS queue, so it is also what
 * `rescheduleAfterUpdate` replays.
 */
export async function listUpcoming(now: number, limit = 200): Promise<ReminderWithText[]> {
  const db = await driver();
  const rows = await db.all<ReminderRow>(
    `SELECT * FROM reminders
      WHERE enabled = 1 AND notified_at IS NULL AND fire_at > ?
      ORDER BY fire_at ASC
      LIMIT ?;`,
    [now, Math.min(Math.max(1, limit), 500)],
  );
  return rows.map(toReminderWithText);
}

/** Every reminder for an entity, including disabled and already-fired ones. */
export async function listForEntity(
  entityType: ReminderTarget,
  entityId: string,
): Promise<ReminderWithText[]> {
  const db = await driver();
  const rows = await db.all<ReminderRow>(
    `SELECT * FROM reminders
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY fire_at ASC;`,
    [entityType, entityId],
  );
  return rows.map(toReminderWithText);
}

/** All enabled reminders, newest first, for the settings screen. */
export async function listEnabled(limit = 100): Promise<ReminderWithText[]> {
  const db = await driver();
  const rows = await db.all<ReminderRow>(
    'SELECT * FROM reminders WHERE enabled = 1 ORDER BY fire_at ASC LIMIT ?;',
    [Math.min(Math.max(1, limit), 500)],
  );
  return rows.map(toReminderWithText);
}

export async function countEnabled(): Promise<number> {
  const db = await driver();
  const row = await db.first<{ n: number | null }>(
    'SELECT COUNT(*) AS n FROM reminders WHERE enabled = 1;',
  );
  return row?.n ?? 0;
}

/**
 * Advances a repeating reminder to its next fire time.
 *
 * Returns false when the reminder has no further occurrence, which tells the caller to
 * disable it rather than leaving a rule that can never fire.
 */
export async function advanceReminder(
  id: string,
  nextFireAt: number,
): Promise<ReminderWithText | null> {
  const db = await driver();
  await db.run('UPDATE reminders SET fire_at = ?, notified_at = NULL, updated_at = ? WHERE id = ?;', [
    nextFireAt,
    Date.now(),
    id,
  ]);
  announce();
  return getReminder(id);
}

/** Marks a one-shot reminder as delivered so it is never resurrected by a reschedule. */
export async function markNotified(id: string): Promise<void> {
  const db = await driver();
  await db.run('UPDATE reminders SET notified_at = ?, updated_at = ? WHERE id = ?;', [
    Date.now(),
    Date.now(),
    id,
  ]);
  announce();
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  const db = await driver();
  await db.run('UPDATE reminders SET enabled = ?, updated_at = ? WHERE id = ?;', [
    enabled ? 1 : 0,
    Date.now(),
    id,
  ]);
  announce();
}

/** Cancels a reminder outright. Used when its entity is deleted or archived. */
export async function deleteReminder(id: string): Promise<void> {
  const db = await driver();
  await db.run('DELETE FROM reminders WHERE id = ?;', [id]);
  announce();
}

/** Cancels every reminder for an entity, e.g. when a habit is removed. */
export async function deleteForEntity(
  entityType: ReminderTarget,
  entityId: string,
): Promise<number> {
  const db = await driver();
  const result = await db.run('DELETE FROM reminders WHERE entity_type = ? AND entity_id = ?;', [
    entityType,
    entityId,
  ]);
  if (result.changes > 0) announce();
  return result.changes;
}
