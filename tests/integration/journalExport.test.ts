/**
 * Journal export and the journal lock.
 *
 * Two properties are worth more than the rest, and both get their own describe block:
 *
 * 1. **Bodies are not exported unless asked for.** `SECURITY/PRIVACY.md` and
 *    `FEATURES/JOURNAL.md` treat journal text as the most private data in the app, so the
 *    default export is a list of dates and moods, and the file *says* that it is rather
 *    than quietly producing something that looks complete.
 * 2. **The lock is not persisted.** An "unlocked" flag in storage would leave the journal
 *    open after a restart, which is the exact failure a lock exists to prevent, so the
 *    state is asserted to be memory-only.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import { MemoryStorageAdapter } from '../support/memoryStorage';
import { runMigrations } from '@/database/migrator';
import { __setDatabaseHandleForTests, __resetDatabaseHandleForTests } from '@/database/database';
import * as repository from '@/repositories/journalRepository';
import type { JournalEntry } from '@/repositories/journalRepository';
import * as journalExport from '@/journal/export';
import * as journalExportService from '@/services/journalExportService';
import { setBiometricAdapter } from '@/platform/biometrics/expoBiometrics';
import type { AuthResult, BiometricAdapter, BiometricCapability } from '@/platform/biometrics/types';
import { AUTH_FAILURE_MESSAGES } from '@/platform/biometrics/types';

let driver: NodeSqliteDriver;
let storage: MemoryStorageAdapter;

beforeEach(async () => {
  driver = new NodeSqliteDriver();
  await runMigrations(driver);
  __setDatabaseHandleForTests(driver, 15);
  storage = new MemoryStorageAdapter();
  journalExportService.configureStorage(storage);
});

afterEach(async () => {
  journalExportService.configureStorage(null);
  setBiometricAdapter(null);
  // The unlock flag is module-level; clearing it keeps tests independent of order.
  journalExportService.lockJournal();
  __resetDatabaseHandleForTests();
  await driver.close();
});

/** Decodes a stored file so assertions can be made against its text, not its bytes. */
async function readText(adapter: MemoryStorageAdapter, path: string): Promise<string> {
  return new TextDecoder().decode(await adapter.readAll(path));
}

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 'e1',
    entryDate: '2026-03-10',
    title: 'A quiet morning',
    body: 'Private writing that should not travel by default.',
    mood: 'Calm',
    moodScore: 8,
    isFavorite: false,
    tags: ['morning'],
    createdAt: 1_772_000_000_000,
    updatedAt: 1_772_000_000_000,
    ...overrides,
  };
}

/* ----------------------------------------------------------------- render */

describe('markdown export', () => {
  it('omits entry bodies by default', () => {
    const result = journalExport.toMarkdown([entry()]);

    expect(result.text).not.toContain('Private writing');
    expect(result.count).toBe(1);
  });

  it('includes bodies when the user asks for them', () => {
    const result = journalExport.toMarkdown([entry()], { includeBody: true });

    expect(result.text).toContain('Private writing');
    expect(result.text).toContain('## 2026-03-10');
  });

  it('says out loud that the text was left out', () => {
    // A file that silently omits the body reads as if the body were empty.
    expect(journalExport.toMarkdown([entry()]).text).toMatch(/text was not included/i);
    expect(journalExport.toMarkdown([entry()], { includeBody: true }).text).not.toMatch(
      /text was not included/i,
    );
  });

  it('orders entries by date regardless of the order they came in', () => {
    const result = journalExport.toMarkdown(
      [entry({ id: 'b', entryDate: '2026-03-02' }), entry({ id: 'a', entryDate: '2026-03-09' })],
      { includeBody: true },
    );

    expect(result.text.indexOf('2026-03-02')).toBeLessThan(result.text.indexOf('2026-03-09'));
  });

  it('lists mood, score, tags and the favourite flag', () => {
    const result = journalExport.toMarkdown([entry({ isFavorite: true })], { includeBody: true });

    expect(result.text).toContain('Mood: Calm');
    expect(result.text).toContain('8/10');
    expect(result.text).toContain('Tags: morning');
    expect(result.text).toContain('Favourite');
  });

  it('can drop tags', () => {
    const result = journalExport.toMarkdown([entry()], { includeTags: false });
    expect(result.text).not.toContain('Tags: morning');
  });

  it('produces a readable, honest document for no entries at all', () => {
    const result = journalExport.toMarkdown([]);

    expect(result.count).toBe(0);
    expect(result.totalCount).toBe(0);
    expect(result.text).toMatch(/no entries matched/i);
  });
});

describe('json export', () => {
  it('is shaped for re-import, not for reading', () => {
    const document = JSON.parse(journalExport.toJson([entry()]).text) as {
      format: string;
      version: number;
      count: number;
      includesBody: boolean;
      entries: { id: string; date: string; body?: string }[];
    };

    expect(document.format).toBe('lifeos-journal');
    expect(document.version).toBe(1);
    expect(document.count).toBe(1);
    expect(document.includesBody).toBe(false);
    expect(document.entries[0]?.body).toBeUndefined();
  });

  it('carries the body only when asked', () => {
    const document = JSON.parse(
      journalExport.toJson([entry()], { includeBody: true }).text,
    ) as { entries: { body: string }[] };

    expect(document.entries[0]?.body).toBe(entry().body);
  });

  it('is valid JSON even when a body contains quotes and newlines', () => {
    const document = JSON.parse(
      journalExport.toJson([entry({ body: 'He said "hello"\nthen left.' })], { includeBody: true }).text,
    ) as { entries: { body: string }[] };

    expect(document.entries[0]?.body).toBe('He said "hello"\nthen left.');
  });
});

describe('csv export', () => {
  it('quotes every field and doubles internal quotes', () => {
    const rows = journalExport.toCsv([entry({ body: 'a, b "c"' })], { includeBody: true }).text.split('\n');
    const dataRow = rows[1] ?? '';

    expect(dataRow.startsWith('"2026-03-10"')).toBe(true);
    expect(dataRow).toContain('"a, b ""c"""');
  });

  it('keeps the header stable whether or not bodies are included', () => {
    // The header is a fixed row of identifiers containing nothing that needs escaping,
    // so it is written bare while every data field is quoted.
    const header = journalExport.toCsv([entry()]).text.split('\n')[0];
    expect(header).toBe('date,title,body,mood,mood_score,tags,favorite');
  });

  it('writes an empty body cell when text is excluded', () => {
    const row = journalExport.toCsv([entry()]).text.split('\n')[1] ?? '';
    expect(row).toContain('""');
    expect(row).not.toContain('Private writing');
  });
});

describe('filters and summary', () => {
  const three = [
    entry({ id: 'a', entryDate: '2026-03-01', isFavorite: true }),
    entry({ id: 'b', entryDate: '2026-03-02', isFavorite: false }),
    entry({ id: 'c', entryDate: '2026-03-03', isFavorite: true }),
  ];

  it('keeps favourites only when asked', () => {
    const result = journalExport.toMarkdown(three, { favouritesOnly: true });

    expect(result.count).toBe(2);
    expect(result.totalCount).toBe(3);
  });

  it('describes itself in one line, including what it left out', () => {
    expect(journalExport.toMarkdown(three).summary).toBe('3 of 3 entries · text not included');
    expect(journalExport.toMarkdown(three, { includeBody: true }).summary).toBe('3 of 3 entries');
  });

  it('agrees across every format', () => {
    for (const format of journalExport.EXPORT_FORMATS) {
      const result = journalExport.exportEntries(three, format, { favouritesOnly: true });
      expect(result.count).toBe(2);
      expect(result.totalCount).toBe(3);
    }
  });

  it('falls back to markdown for an unrecognised format rather than throwing', () => {
    const result = journalExport.exportEntries(three, 'pdf' as journalExport.ExportFormat);
    expect(result.text.startsWith('# Journal')).toBe(true);
  });
});

describe('exportFileName', () => {
  it('is dated and filesystem-legal', () => {
    expect(journalExport.exportFileName('csv', '2026-03-10')).toBe('lifeos-journal-2026-03-10.csv');
    expect(journalExport.exportFileName('markdown', '2026-03-10')).toBe(
      'lifeos-journal-2026-03-10.md',
    );
    expect(journalExport.exportFileName('json', '2026-03-10')).toBe('lifeos-journal-2026-03-10.json');
  });

  it('has a label for every format it offers', () => {
    for (const format of journalExport.EXPORT_FORMATS) {
      expect(journalExport.EXPORT_FORMAT_LABELS[format]).toBeTruthy();
      expect(journalExport.EXPORT_FORMAT_EXTENSIONS[format]).toBeTruthy();
    }
  });
});

/* ------------------------------------------------------------ write to disk */

describe('exportJournal', () => {
  async function seed(): Promise<void> {
    await repository.insertEntry({
      entryDate: '2026-03-10',
      title: 'A quiet morning',
      body: 'Private writing.',
      mood: 'Calm',
      moodScore: 8,
      isFavorite: false,
      tags: '["morning"]',
    });
  }

  it('writes the file and reports where it went', async () => {
    await seed();

    const outcome = await journalExportService.exportJournal({
      format: 'markdown',
      today: '2026-03-10',
      storage,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.export.filePath).toBe('exports/lifeos-journal-2026-03-10.md');
    expect(outcome.export.sizeBytes).toBeGreaterThan(0);
    expect(await storage.exists(outcome.export.filePath)).toBe(true);
  });

  it('publishes the final name only after the bytes are in place', async () => {
    await seed();

    const outcome = await journalExportService.exportJournal({
      format: 'csv',
      today: '2026-03-10',
      storage,
    });
    if (!outcome.ok) throw new Error('expected ok');

    // Written as `.part`, then renamed. An interrupted export therefore leaves an orphan
    // rather than a truncated file that looks complete.
    expect(storage.writeLog[0]).toBe(`${outcome.export.filePath}.part`);
    expect(storage.writeLog).not.toContain(outcome.export.filePath.slice(0, -1));
    expect(await storage.exists(`${outcome.export.filePath}.part`)).toBe(false);
    expect(await storage.exists(outcome.export.filePath)).toBe(true);
  });

  it('reads the journal from the database when entries are not passed in', async () => {
    await seed();

    const outcome = await journalExportService.exportJournal({
      format: 'json',
      today: '2026-03-10',
      storage,
    });
    if (!outcome.ok) throw new Error('expected ok');

    expect(outcome.export.count).toBe(1);
    expect(outcome.export.text).toContain('2026-03-10');
  });

  it('honours the body filter all the way to disk', async () => {
    await seed();

    // Different dates so the two runs write two files rather than overwriting each other.
    const withoutBody = await journalExportService.exportJournal({
      format: 'markdown', today: '2026-03-10', storage,
    });
    const withBody = await journalExportService.exportJournal({
      format: 'markdown', today: '2026-03-11', storage, filters: { includeBody: true },
    });
    if (!withoutBody.ok || !withBody.ok) throw new Error('expected ok');

    expect(await readText(storage, withoutBody.export.filePath)).not.toContain('Private writing');
    expect(await readText(storage, withBody.export.filePath)).toContain('Private writing');
  });

  it('fails honestly, without a half-written file, when storage refuses', async () => {
    await seed();
    storage.setFreeSpace(0);

    const outcome = await journalExportService.exportJournal({
      format: 'markdown',
      today: '2026-03-10',
      storage,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toMatch(/has not changed/i);
    expect(await storage.list('exports')).toEqual([]);
  });

  it('leaves the journal itself untouched', async () => {
    await seed();

    await journalExportService.exportJournal({
      format: 'markdown', today: '2026-03-10', storage,
    });

    expect(await repository.listEntries({})).toHaveLength(1);
  });
});

describe('listing and deleting exports', () => {
  it('lists only real export files, newest name first', async () => {
    await storage.ensureDirectory('exports');
    await storage.write('exports/lifeos-journal-2026-03-01.csv', new Uint8Array(10));
    await storage.write('exports/lifeos-journal-2026-03-10.md', new Uint8Array(20));
    await storage.write('exports/lifeos-journal-2026-03-10.md.part', new Uint8Array(5));
    await storage.write('exports/notes.txt', new Uint8Array(5));

    const files = await journalExportService.listExports(storage);

    expect(files.map((f) => f.filePath)).toEqual([
      'exports/lifeos-journal-2026-03-10.md',
      'exports/lifeos-journal-2026-03-01.csv',
    ]);
    expect(files[0]?.sizeBytes).toBe(20);
  });

  it('returns nothing rather than throwing when the directory is missing', async () => {
    expect(await journalExportService.listExports(storage)).toEqual([]);
  });

  it('deletes one file without touching the others', async () => {
    await storage.write('exports/a.md', new Uint8Array(1));
    await storage.write('exports/b.md', new Uint8Array(1));

    await journalExportService.deleteExport('exports/a.md', storage);

    expect(await storage.exists('exports/a.md')).toBe(false);
    expect(await storage.exists('exports/b.md')).toBe(true);
  });

  it('swallows a delete failure, because a stuck file must not break the screen', async () => {
    await expect(
      journalExportService.deleteExport('../escape.md', storage),
    ).resolves.toBeUndefined();
  });
});

/* --------------------------------------------------------------- the lock */

function fakeBiometrics(
  options: { capability?: Partial<BiometricCapability>; result?: AuthResult } = {},
): BiometricAdapter {
  const capability: BiometricCapability = {
    available: true,
    enrolled: true,
    method: 'fingerprint',
    reason: null,
    passcodeOnly: false,
    ...options.capability,
  };
  return {
    get available() {
      return capability.available;
    },
    capability: async () => capability,
    authenticate: async () => options.result ?? { ok: true },
    hasDeviceCredential: async () => capability.available,
  };
}

describe('journal lock', () => {
  it('stays shut while locked', async () => {
    setBiometricAdapter(fakeBiometrics());
    journalExportService.lockJournal();

    expect(await journalExportService.isJournalUnlocked()).toBe(false);
    expect(await journalExportService.shouldHideJournal(true)).toBe(true);
  });

  it('opens after a successful authentication', async () => {
    setBiometricAdapter(fakeBiometrics());
    journalExportService.lockJournal();

    const outcome = await journalExportService.unlockJournal();

    expect(outcome).toEqual({ ok: true });
    expect(await journalExportService.shouldHideJournal(true)).toBe(false);
  });

  it('stays shut when authentication fails, and returns the reason', async () => {
    setBiometricAdapter(
      fakeBiometrics({
        result: { ok: false, failure: 'user_cancelled', message: AUTH_FAILURE_MESSAGES.user_cancelled },
      }),
    );
    journalExportService.lockJournal();

    const outcome = await journalExportService.unlockJournal();

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toMatch(/cancelled/i);
    expect(await journalExportService.shouldHideJournal(true)).toBe(true);
  });

  it('relocks when the app is backgrounded', async () => {
    setBiometricAdapter(fakeBiometrics());
    await journalExportService.unlockJournal();
    expect(await journalExportService.shouldHideJournal(true)).toBe(false);

    journalExportService.lockJournal();

    expect(await journalExportService.shouldHideJournal(true)).toBe(true);
  });

  it('never persists the unlocked state, so a restart re-locks it', async () => {
    setBiometricAdapter(fakeBiometrics());
    await repository.insertEntry({
      entryDate: '2026-03-10', title: null, body: 'x', mood: null,
      moodScore: null, isFavorite: false, tags: null,
    });
    await journalExportService.unlockJournal();

    // Nothing anywhere in the database records that the journal was opened.
    const row = await driver.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM preferences WHERE key LIKE '%unlock%' OR key LIKE '%lock%';`,
    );
    expect(row?.count ?? 0).toBe(0);
  });

  it('hides nothing when the lock is switched off', async () => {
    setBiometricAdapter(fakeBiometrics());
    journalExportService.lockJournal();

    expect(await journalExportService.shouldHideJournal(false)).toBe(false);
  });

  it('says why the lock cannot be enabled when nothing is enrolled', async () => {
    setBiometricAdapter(
      fakeBiometrics({
        capability: {
          available: true,
          enrolled: false,
          method: 'passcode',
          reason: 'Set up a fingerprint or face unlock on this device.',
          passcodeOnly: true,
        },
      }),
    );

    const state = await journalExportService.lockState(true);

    expect(state.enabled).toBe(true);
    expect(state.blockedReason).toMatch(/fingerprint or face/i);
    expect(state.capability.passcodeOnly).toBe(true);
  });

  it('reports no blocker once the lock is off', async () => {
    setBiometricAdapter(
      fakeBiometrics({ capability: { available: false, enrolled: false, reason: 'no hardware' } }),
    );

    const state = await journalExportService.lockState(false);

    expect(state.blockedReason).toBeNull();
  });

  it('works on a device that cannot authenticate at all', async () => {
    setBiometricAdapter(null);
    journalExportService.lockJournal();

    const outcome = await journalExportService.unlockJournal();
    expect(outcome.ok).toBe(false);

    // The journal is still readable; an absent biometric must never lock the user out
    // of their own data.
    expect(await journalExportService.shouldHideJournal(false)).toBe(false);
  });
});

describe('the privacy warning', () => {
  it('names the actual risk rather than boilerplate', () => {
    expect(journalExport.EXPORT_PRIVACY_WARNING).toMatch(/LifeOS lock/);
    expect(journalExport.EXPORT_PRIVACY_WARNING).toMatch(/device/);
  });
});