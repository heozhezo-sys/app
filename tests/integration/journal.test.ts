/**
 * Journal end to end through service -> repository -> real SQLite.
 *
 * Two things here are about the property rather than the function:
 *
 * 1. **Privacy.** `FEATURES/JOURNAL.md` requires journal contents are never transmitted
 *    silently. That is asserted structurally — the journal module graph is walked and the
 *    test fails if any networking library appears. A privacy claim that only lives in a
 *    comment decays the first time somebody adds an import.
 * 2. **Search degradation.** FTS5 is a capability, not an assumption. Both the indexed and
 *    the `LIKE` fallback paths are exercised against real SQL, because a fallback nobody
 *    tests is a fallback that does not work on the Android builds that need it.
 */

import { readFileSync } from 'fs';
import * as path from 'path';

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import {
  __resetDatabaseHandleForTests,
  __setDatabaseHandleForTests,
  getDatabase,
} from '@/database/database';
import { runMigrations } from '@/database/migrator';
import { LATEST_SCHEMA_VERSION } from '@/database/migrations/types';
import { MemoryStorageAdapter } from '../support/memoryStorage';
import * as journal from '@/services/journalService';
import * as booksService from '@/services/booksService';
import { ValidationError } from '@/services/errors';

let driver: NodeSqliteDriver;
let now = new Date(2026, 0, 15, 21, 0).getTime();

beforeEach(async () => {
  driver = new NodeSqliteDriver();
  await runMigrations(driver);
  __setDatabaseHandleForTests(driver, LATEST_SCHEMA_VERSION);
  now = new Date(2026, 0, 15, 21, 0).getTime();
  journal.setClock(() => now);
  booksService.configureStorage(new MemoryStorageAdapter());
});

afterEach(async () => {
  journal.resetClock();
  booksService.configureStorage(new MemoryStorageAdapter());
  __resetDatabaseHandleForTests();
  await driver.close();
});

async function entry(overrides: Partial<Parameters<typeof journal.createEntry>[0]> = {}) {
  return journal.createEntry({ body: 'A quiet day.', ...overrides });
}
describe('journal entries', () => {
  it('creates an entry dated today when no date is given', async () => {
    const created = await entry({ title: 'Evening' });

    expect(created.entryDate).toBe('2026-01-15');
    expect(created.title).toBe('Evening');
    expect(created.isFavorite).toBe(false);
    expect(created.moodScore).toBeNull();
  });

  it('stores a title as absent rather than an empty string', async () => {
    expect((await entry({ title: '   ' })).title).toBeNull();
  });

  it('requires a body', async () => {
    await expect(journal.createEntry({ body: '  ' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a mood score outside one to ten', async () => {
    await expect(entry({ moodScore: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(entry({ moodScore: 11 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('normalises tags on the way in', async () => {
    expect((await entry({ tags: 'Work, work, ideas' })).tags).toEqual(['Work', 'ideas']);
  });

  it('edits only the fields supplied', async () => {
    const created = await entry({ title: 'Original', body: 'Body', mood: 'Calm' });

    const edited = await journal.editEntry(created.id, { body: 'New body' });

    // Changing the body must not clear the title or mood the user already wrote.
    expect(edited?.body).toBe('New body');
    expect(edited?.title).toBe('Original');
    expect(edited?.mood).toBe('Calm');
  });

  it('applies the same validation to an edit as to a create', async () => {
    const created = await entry();
    await expect(journal.editEntry(created.id, { body: '' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('lists entries newest first', async () => {
    await journal.createEntry({ entryDate: '2026-01-10', body: 'Older' });
    await journal.createEntry({ entryDate: '2026-01-15', body: 'Newer' });

    expect((await journal.listEntries()).map((e) => e.body)).toEqual(['Newer', 'Older']);
  });

  it('bounds a listing so a long journal cannot stall the screen', async () => {
    for (let i = 0; i < 12; i += 1) {
      const day = String(i + 1).padStart(2, '0');
      await journal.createEntry({ entryDate: `2026-01-${day}`, body: `E${i}` });
    }

    expect(await journal.listEntries({ limit: 5 })).toHaveLength(5);
  });

  it('filters by date range', async () => {
    await journal.createEntry({ entryDate: '2026-01-10', body: 'Before' });
    await journal.createEntry({ entryDate: '2026-01-15', body: 'Inside' });
    await journal.createEntry({ entryDate: '2026-01-20', body: 'After' });

    const list = await journal.listEntries({ from: '2026-01-12', to: '2026-01-18' });
    expect(list.map((e) => e.body)).toEqual(['Inside']);
  });

  it('toggles the favourite flag in both directions', async () => {
    const created = await entry();

    expect((await journal.toggleFavorite(created.id))?.isFavorite).toBe(true);
    expect((await journal.toggleFavorite(created.id))?.isFavorite).toBe(false);
  });

  it('lists favourites only', async () => {
    const first = await entry({ body: 'Kept' });
    await entry({ body: 'Not kept' });
    await journal.toggleFavorite(first.id);

    const favorites = await journal.listFavorites();
    expect(favorites).toHaveLength(1);
    expect(favorites[0]?.body).toBe('Kept');
  });

  it('soft deletes, so a mistaken tap does not destroy writing', async () => {
    const created = await entry();
    await journal.deleteEntry(created.id);

    expect(await journal.getEntry(created.id)).toBeNull();
    expect(await journal.listEntries()).toHaveLength(0);
  });

  it('finds related entries by shared tag', async () => {
    await entry({ body: 'First', tags: ['work'] });
    const target = await entry({ body: 'Second', tags: ['work', 'rest'] });
    await entry({ body: 'Third', tags: ['health'] });

    expect((await journal.listRelated(target.id)).map((e) => e.body)).toEqual(['First']);
  });

  it('finds no related entries for an untagged entry', async () => {
    const target = await entry({ body: 'Alone' });
    await entry({ body: 'Other', tags: ['work'] });

    expect(await journal.listRelated(target.id)).toEqual([]);
  });
});

describe('search', () => {
  beforeEach(async () => {
    await journal.createEntry({ title: 'Deep work', body: 'A long day of focus.' });
    await journal.createEntry({ title: 'Rest', body: 'Slept well.' });
    await journal.createEntry({
      title: 'Reading',
      body: 'Finished a book about focus.',
      tags: ['deep'],
    });
  });

  it('finds entries by body text', async () => {
    expect((await journal.search('focus')).entries).toHaveLength(2);
  });

  it('finds entries by title', async () => {
    const result = await journal.search('reading');
    expect(result.entries.map((e) => e.title)).toEqual(['Reading']);
  });

  it('finds entries by tag', async () => {
    expect((await journal.search('deep')).entries).toHaveLength(2);
  });

  it('returns nothing for a term that appears nowhere', async () => {
    expect((await journal.search('helicopter')).entries).toEqual([]);
  });

  it('excludes a soft-deleted entry', async () => {
    const created = await journal.createEntry({ body: 'Secret helicopter plans' });
    await journal.deleteEntry(created.id);

    expect((await journal.search('helicopter')).entries).toEqual([]);
  });

  it('treats an empty query as a plain listing', async () => {
    expect((await journal.search('   ')).entries.length).toBeGreaterThan(0);
  });

  it('treats LIKE wildcards as literal characters', async () => {
    // Unescaped, "%" would match every entry.
    expect((await journal.search('%')).entries).toEqual([]);
  });

  it('survives a query containing FTS5 operator characters', async () => {
    // Must not throw, whichever engine answers.
    await expect(journal.search('a*b: c-d')).resolves.toBeTruthy();
    await expect(journal.search('"quoted"')).resolves.toBeTruthy();
  });

  it('restricts to favourites when asked', async () => {
    const [first] = await journal.listEntries();
    await journal.toggleFavorite(first?.id ?? '');

    const result = await journal.search('focus', { favouritesOnly: true });
    expect(result.entries.every((e) => e.isFavorite)).toBe(true);
  });

  it('reports which engine answered', async () => {
    // Whichever path ran, the caller is told rather than left to assume the fast one.
    expect(['fts5', 'like']).toContain((await journal.search('focus')).strategy);
  });

  it('returns the same matches when FTS5 is unavailable', async () => {
    const db = (await getDatabase()).driver;
    // Force the fallback the way an Android build without FTS5 would take it.
    await db.run("UPDATE search_capabilities SET enabled = 0 WHERE name = 'fts5';");

    const result = await journal.search('focus');
    expect(result.strategy).toBe('like');
    expect(result.entries).toHaveLength(2);
  });

  it('uses the index when FTS5 is available', async () => {
    const db = (await getDatabase()).driver;
    await db.run("UPDATE search_capabilities SET enabled = 1 WHERE name = 'fts5';");

    const result = await journal.search('focus');
    expect(result.strategy).toBe('fts5');
    expect(result.entries).toHaveLength(2);
  });
});

describe('attachments', () => {
  it('records an attachment against an entry', async () => {
    const created = await entry();
    const attachment = await journal.attachFile({
      entryId: created.id,
      storedPath: 'journal/photo.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
    });

    expect(attachment.fileName).toBe('journal/photo.png');
    expect(await journal.listAttachments(created.id)).toHaveLength(1);
  });

  it('requires an entry and a path', async () => {
    await expect(
      journal.attachFile({ entryId: '', storedPath: 'a.png' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      journal.attachFile({ entryId: 'e1', storedPath: '  ' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('treats a missing size as zero rather than null', async () => {
    const created = await entry();
    const attachment = await journal.attachFile({
      entryId: created.id,
      storedPath: 'journal/note.txt',
    });

    expect(attachment.sizeBytes).toBe(0);
  });

  it('hides the row and removes the file when detached', async () => {
    const storage = new MemoryStorageAdapter();
    storage.seedFile('journal/photo.png', new Uint8Array([1, 2, 3]));
    booksService.configureStorage(storage);

    const created = await entry();
    const attachment = await journal.attachFile({
      entryId: created.id,
      storedPath: 'journal/photo.png',
    });

    await journal.detachFile(attachment.id);

    expect(await journal.listAttachments(created.id)).toEqual([]);
    expect(await storage.exists('journal/photo.png')).toBe(false);
  });
});

describe('privacy', () => {
  /**
   * Walks the journal module graph and asserts no networking library is reachable.
   *
   * `FEATURES/JOURNAL.md` says journal contents must never be transmitted silently. That
   * is a structural property of the code, so it is tested structurally rather than trusted
   * to a comment the next developer will not read.
   */
  it('keeps journal contents on the device', () => {
    const root = path.resolve(__dirname, '..', '..', 'src');
    const forbidden = [
      'expo-network',
      '@react-native-community/netinfo',
      'axios',
      'node-fetch',
      'react-native-fs',
    ];

    const seen = new Set<string>();
    const offenders: string[] = [];

    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);

      const source = readFileSync(file, 'utf8');
      for (const library of forbidden) {
        if (source.includes(`'${library}'`) || source.includes(`"${library}"`)) {
          offenders.push(`${path.relative(root, file)} imports ${library}`);
        }
      }

      for (const match of source.matchAll(/from '(@\/[^']+)'/g)) {
        const specifier = match[1];
        if (specifier) walk(resolveModule(root, specifier));
      }
    };

    for (const start of ['@/journal/tags', '@/journal/search', '@/services/journalService']) {
      walk(resolveModule(root, start));
    }

    expect(offenders).toEqual([]);
  });

  it('has no sync, share or upload entry point', () => {
    const source = readFileSync(
      path.resolve(__dirname, '..', '..', 'src', 'services', 'journalService.ts'),
      'utf8',
    );

    // Nothing in the journal use-case layer may transmit an entry.
    expect(source).not.toMatch(
      /export\s+(async\s+)?function\s+(sync|share|upload|publish|send)\b/i,
    );
  });
});

/** Resolves an `@/...` specifier to a file, following a directory to its index file. */
function resolveModule(root: string, specifier: string): string {
  const base = path.join(root, specifier.replace(/^@\//, ''));

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    if (readable(candidate)) return candidate;
  }
  // Unresolvable imports are ignored: this test is about what is present, and a missing
  // file is a typecheck failure rather than a privacy one.
  return `${base}.ts`;
}

function readable(file: string): boolean {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}
