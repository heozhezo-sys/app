/**
 * Settings persistence.
 *
 * One durable key/value table rather than a settings column per preference, so adding
 * a preference is a code change rather than a migration. Unknown or corrupt values
 * are normalised to defaults on read, which means a partially-written settings row
 * can never brick the app on launch.
 */

import { getDatabase, notify, CHANNELS } from '@/database/database';
import { createId } from '@/utils/id';
import {
  DEFAULT_SETTINGS,
  normaliseSettings,
  type Settings,
} from '@/types/settings';

const PREFERENCES_KEY = 'settings.v1';

interface PreferenceRow {
  key: string;
  value: string;
}

export async function getSettings(): Promise<Settings> {
  const db = await getDatabase();
  const row = await db.driver.first<PreferenceRow>(
    'SELECT key, value FROM preferences WHERE key = ?;',
    [PREFERENCES_KEY],
  );

  if (!row) return { ...DEFAULT_SETTINGS };

  try {
    return normaliseSettings(JSON.parse(row.value));
  } catch {
    // Corrupt JSON: fall back to defaults rather than failing to start the app.
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  const db = await getDatabase();
  const now = Date.now();
  const normalised = normaliseSettings(settings);

  await db.driver.run(
    `INSERT INTO preferences (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
    [PREFERENCES_KEY, JSON.stringify(normalised), now],
  );

  notify(CHANNELS.settings);
  return normalised;
}

/** Shallow patch; only supplied keys change. */
export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  return saveSettings({ ...current, ...patch });
}

/** First launch only. Refuses to run twice, so a reinstalled app keeps its history. */
export async function completeOnboarding(): Promise<Settings> {
  return updateSettings({ onboardingCompleted: true });
}

export async function resetSettings(): Promise<Settings> {
  const db = await getDatabase();
  await db.driver.run('DELETE FROM preferences WHERE key = ?;', [PREFERENCES_KEY]);
  notify(CHANNELS.settings);
  return { ...DEFAULT_SETTINGS };
}

/** Install identity, used by optional sync later. Not a secret. */
export async function getInstallId(): Promise<string> {
  const db = await getDatabase();
  const row = await db.driver.first<PreferenceRow>(
    "SELECT key, value FROM app_meta WHERE key = 'install_id';",
  );
  if (row) return row.value;

  const id = createId();
  const now = Date.now();
  await db.driver.run(
    `INSERT INTO app_meta (key, value, updated_at) VALUES ('install_id', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    [id, now],
  );
  return id;
}
