/**
 * Sport catalogue and session persistence.
 *
 * One `SportSession` model serves every sport. What differs between sports is the
 * metric schema stored on the sport row, which is what makes metrics configurable
 * without a migration per sport. Running declares distance and pace; boxing declares
 * rounds and work time; a user's custom sport can declare whatever they like.
 */

import type { SqlDriver, SqlValue } from '@/database/driver';
import { getDatabase, notify, CHANNELS } from '@/database/database';
import { createId } from '@/utils/id';
import type { SportCategory, SportMetric } from '@/data/sportsCatalog';
import type { Sport, SportSession, SportSessionWithSport } from '@/types/fitness';

interface SportRow {
  id: string;
  name: string;
  category: SportCategory;
  metric_schema: string | null;
  is_custom: number;
  created_at: number;
  updated_at: number;
}

interface SessionRow {
  id: string;
  sport_id: string;
  started_at: number;
  ended_at: number | null;
  duration_sec: number | null;
  intensity: SportSession['intensity'];
  metrics: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

/** Unparseable metric schemas must not make a sport unusable. */
function parseMetricSchema(raw: string | null): SportMetric[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is SportMetric =>
        typeof m === 'object' &&
        m !== null &&
        typeof (m as SportMetric).key === 'string' &&
        typeof (m as SportMetric).label === 'string',
    );
  } catch {
    return [];
  }
}

/** Unparseable metric values are dropped rather than crashing a list render. */
function parseMetrics(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' && Number.isFinite(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function toSport(row: SportRow): Sport {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    metrics: parseMetricSchema(row.metric_schema),
    isCustom: row.is_custom === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSession(row: SessionRow): SportSession {
  return {
    id: row.id,
    sportId: row.sport_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSec: row.duration_sec,
    intensity: row.intensity,
    metrics: parseMetrics(row.metrics),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function driver(): Promise<SqlDriver> {
  return (await getDatabase()).driver;
}

function announce(): void {
  notify(CHANNELS.sports);
  notify(CHANNELS.today);
}

export async function listSports(category?: SportCategory): Promise<Sport[]> {
  const db = await driver();
  const rows = await db.all<SportRow>(
    `SELECT * FROM sports
      WHERE deleted_at IS NULL
        AND (? IS NULL OR category = ?)
      ORDER BY name ASC;`,
    [category ?? null, category ?? null],
  );
  return rows.map(toSport);
}

export async function getSport(id: string): Promise<Sport | null> {
  const db = await driver();
  const row = await db.first<SportRow>('SELECT * FROM sports WHERE id = ? AND deleted_at IS NULL;', [
    id,
  ]);
  return row ? toSport(row) : null;
}

/**
 * Creates a user-defined sport. A partial unique index refuses a duplicate name, so
 * the database rejects it rather than silently creating two identical entries.
 */
export async function insertCustomSport(input: {
  name: string;
  category: SportCategory;
  metrics: SportMetric[];
}): Promise<Sport> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO sports (id, name, category, metric_schema, is_custom, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?);`,
    [id, input.name, input.category, JSON.stringify(input.metrics), now, now],
  );

  announce();
  const created = await getSport(id);
  if (!created) throw new Error(`Sport ${id} vanished immediately after insert`);
  return created;
}
export async function listSportSessions(options: {
  sportId?: string;
  sinceDays?: number;
  limit?: number;
} = {}): Promise<SportSessionWithSport[]> {
  const db = await driver();
  const since = options.sinceDays === undefined ? null : Date.now() - options.sinceDays * 86_400_000;

  const rows = await db.all<SessionRow & { sport_name: string; metric_schema: string | null }>(
    `SELECT s.*, sp.name AS sport_name, sp.metric_schema
       FROM sport_sessions s
       JOIN sports sp ON sp.id = s.sport_id
      WHERE s.deleted_at IS NULL
        AND (? IS NULL OR s.sport_id = ?)
        AND (? IS NULL OR s.started_at >= ?)
      ORDER BY s.started_at DESC
      LIMIT ?;`,
    [
      options.sportId ?? null,
      options.sportId ?? null,
      since,
      since,
      options.limit ?? 100,
    ],
  );

  return rows.map((row) => ({
    ...toSession(row),
    sportName: row.sport_name,
    metricSchema: parseMetricSchema(row.metric_schema),
  }));
}

export async function getSportSession(id: string): Promise<SportSession | null> {
  const db = await driver();
  const row = await db.first<SessionRow>(
    'SELECT * FROM sport_sessions WHERE id = ? AND deleted_at IS NULL;',
    [id],
  );
  return row ? toSession(row) : null;
}

export async function insertSportSession(input: {
  sportId: string;
  startedAt: number;
  endedAt: number | null;
  durationSec: number | null;
  intensity: SportSession['intensity'];
  metrics: Record<string, number>;
  notes: string | null;
}): Promise<SportSession> {
  const db = await driver();
  const now = Date.now();
  const id = createId();

  await db.run(
    `INSERT INTO sport_sessions
       (id, sport_id, started_at, ended_at, duration_sec, intensity, metrics, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.sportId,
      input.startedAt,
      input.endedAt,
      input.durationSec,
      input.intensity,
      JSON.stringify(input.metrics),
      input.notes,
      now,
      now,
    ],
  );

  announce();
  const created = await getSportSession(id);
  if (!created) throw new Error(`Sport session ${id} vanished immediately after insert`);
  return created;
}

export async function updateSportSession(
  id: string,
  patch: Partial<{
    endedAt: number | null;
    durationSec: number | null;
    intensity: SportSession['intensity'];
    metrics: Record<string, number>;
    notes: string | null;
  }>,
): Promise<SportSession | null> {
  const db = await driver();
  const columns: string[] = [];
  const params: SqlValue[] = [];
  const set = (column: string, value: SqlValue): void => {
    columns.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.endedAt !== undefined) set('ended_at', patch.endedAt);
  if (patch.durationSec !== undefined) set('duration_sec', patch.durationSec);
  if (patch.intensity !== undefined) set('intensity', patch.intensity);
  if (patch.metrics !== undefined) set('metrics', JSON.stringify(patch.metrics));
  if (patch.notes !== undefined) set('notes', patch.notes);

  if (columns.length === 0) return getSportSession(id);

  set('updated_at', Date.now());
  params.push(id);

  await db.run(
    `UPDATE sport_sessions SET ${columns.join(', ')} WHERE id = ? AND deleted_at IS NULL;`,
    params,
  );
  announce();
  return getSportSession(id);
}

export async function softDeleteSportSession(id: string): Promise<void> {
  const db = await driver();
  await db.run(
    'UPDATE sport_sessions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;',
    [Date.now(), Date.now(), id],
  );
  announce();
}

/** Total distance across sessions for one sport, in metres. */
export async function totalDistanceMetres(sportId: string): Promise<number> {
  const db = await driver();
  const rows = await db.all<{ metrics: string | null }>(
    "SELECT metrics FROM sport_sessions WHERE sport_id = ? AND deleted_at IS NULL;",
    [sportId],
  );
  return rows.reduce(
    (sum, row) => sum + (parseMetrics(row.metrics).distance_m ?? 0),
    0,
  );
}
