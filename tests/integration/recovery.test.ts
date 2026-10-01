/**
 * Recovery: daily ratings and mobility sessions.
 *
 * Runs against real SQLite, so the partial unique index on `log_date` and the CHECK
 * ranges are the actual constraints, not a description of them.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import { runMigrations } from '@/database/migrator';
import { __setDatabaseHandleForTests, __resetDatabaseHandleForTests, CHANNELS, subscribe } from '@/database/database';
import * as service from '@/services/recoveryService';
import * as repository from '@/repositories/recoveryRepository';
import { ValidationError } from '@/services/errors';
import {
  RECOVERY_RATINGS,
  averageRating,
  isValidRating,
  ratingAverage,
  ratingSpread,
  trendBetween,
} from '@/health/recoveryMath';
import {
  formatMinutes,
  isQuietRange,
  summariseMobility,
  validateSessionMinutes,
} from '@/health/mobilityMath';

let driver: NodeSqliteDriver;
let notifications = 0;
let unsubscribe: () => void;

beforeEach(async () => {
  driver = new NodeSqliteDriver();
  await runMigrations(driver);
  __setDatabaseHandleForTests(driver, 14);
  service.resetClock();
  notifications = 0;
  unsubscribe = subscribe(CHANNELS.health, () => {
    notifications += 1;
  });
});

afterEach(async () => {
  unsubscribe();
  __resetDatabaseHandleForTests();
  await driver.close();
});

/* ------------------------------------------------------------------- pure */

describe('rating validation', () => {
  it('accepts only whole numbers inside 1-10', () => {
    expect(isValidRating(1)).toBe(true);
    expect(isValidRating(10)).toBe(true);
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(11)).toBe(false);
    expect(isValidRating(5.5)).toBe(false);
    expect(isValidRating(null)).toBe(false);
    expect(isValidRating('5')).toBe(false);
  });

  it('rejects an out-of-range rating at the service boundary', async () => {
    await expect(service.rateDay({ energy: 11 })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.rateDay({ mood: 0 })).rejects.toMatchObject({
      fields: { mood: expect.any(String) },
    });
  });

  it('rejects an unknown rating key only via the typed rating set', () => {
    expect(RECOVERY_RATINGS).toEqual(['energy', 'soreness', 'recovery', 'mood']);
  });
});

describe('averageRating', () => {
  it('returns null for nothing recorded rather than zero', () => {
    expect(averageRating([])).toBeNull();
    expect(averageRating([null, undefined, null])).toBeNull();
  });

  it('averages only the values that are present', () => {
    expect(averageRating([8, null, 6, undefined])).toBe(7);
    expect(averageRating([7])).toBe(7);
  });

  it('rounds to one decimal', () => {
    expect(averageRating([1, 2, 2])).toBe(1.7);
  });
});

describe('ratingAverage and ratingSpread', () => {
  const series = [
    { energy: 5, mood: 9 },
    { energy: 7, mood: null },
    { energy: null, mood: 6 },
  ];

  it('averages one named rating, ignoring days where it is absent', () => {
    expect(ratingAverage(series, 'energy')).toBe(6);
    expect(ratingAverage(series, 'mood')).toBe(7.5);
    expect(ratingAverage([{ energy: 4 }], 'soreness')).toBeNull();
  });

  it('reports min, max and range', () => {
    expect(ratingSpread([4, 9, 6])).toEqual({ min: 4, max: 9, range: 5 });
  });

  it('reports a null range for fewer than two readings', () => {
    expect(ratingSpread([7])).toEqual({ min: 7, max: 7, range: null });
    expect(ratingSpread([])).toEqual({ min: null, max: null, range: null });
  });
});

describe('trendBetween', () => {
  it('returns null unless both periods have data', () => {
    expect(trendBetween(6, null)).toBeNull();
    expect(trendBetween(null, 6)).toBeNull();
  });

  it('reports direction and delta', () => {
    expect(trendBetween(7, 5)).toEqual({ delta: 2, direction: 'up' });
    expect(trendBetween(4, 5)).toEqual({ delta: -1, direction: 'down' });
    expect(trendBetween(5, 5)).toEqual({ delta: 0, direction: 'flat' });
  });
});

/* ------------------------------------------------------------- persistence */

describe('recording a day', () => {
  it('stores every rating independently', async () => {
    const log = await service.rateDay({ logDate: '2026-03-01', energy: 7, mood: 8 });

    expect(log.energy).toBe(7);
    expect(log.mood).toBe(8);
    expect(log.soreness).toBeNull();
    expect(log.recovery).toBeNull();
  });

  it('re-rating a day replaces it instead of adding a second row', async () => {
    await service.rateDay({ logDate: '2026-03-01', energy: 3 });
    await service.rateDay({ logDate: '2026-03-01', energy: 9 });

    const logs = await repository.listRecoveryLogs('2026-03-01', '2026-03-01');
    expect(logs).toHaveLength(1);
    expect(logs[0]?.energy).toBe(9);
  });

  it('leaves the other ratings untouched when rating just one', async () => {
    await service.rateDay({ logDate: '2026-03-02', energy: 4, mood: 10 });
    await service.rateOne('energy', 6, '2026-03-02');

    const log = await repository.getRecoveryLog('2026-03-02');
    expect(log?.energy).toBe(6);
    expect(log?.mood).toBe(10);
  });

  it('rejects a rating outside 1-10 before it reaches the database', async () => {
    await expect(service.rateOne('mood', 42, '2026-03-01')).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await repository.getRecoveryLog('2026-03-01')).toBeNull();
  });

  it('soft deletes, keeping the row on disk', async () => {
    const log = await service.rateDay({ logDate: '2026-03-03', energy: 5 });
    await service.removeRecoveryDay(log.id);

    expect(await repository.getRecoveryLog('2026-03-03')).toBeNull();
    const row = await driver.first<{ deleted_at: number | null }>(
      'SELECT deleted_at FROM recovery_logs WHERE id = ?;',
      [log.id],
    );
    expect(typeof row?.deleted_at).toBe('number');
  });

  it('rejects an invalid date key at the storage layer', async () => {
    await expect(service.rateDay({ logDate: '2026-3-1', energy: 5 })).rejects.toThrow();
  });

  it('announces the health channel so open screens re-read', async () => {
    await service.rateDay({ logDate: '2026-03-04', energy: 5 });
    expect(notifications).toBeGreaterThan(0);
  });
});

describe('ratedDayCount', () => {
  it('counts only days that carry at least one rating', async () => {
    await service.rateDay({ logDate: '2026-03-01', energy: 5 });
    await service.rateDay({ logDate: '2026-03-02', mood: 5 });
    // A row with every rating null is not a rated day.
    await driver.run(
      `INSERT INTO recovery_logs (id, log_date, energy, soreness, recovery, mood, notes, logged_at, created_at, updated_at)
       VALUES ('empty', '2026-03-03', NULL, NULL, NULL, NULL, NULL, 1, 1, 1);`,
    );

    expect(await repository.ratedDayCount('2026-03-01', '2026-03-03')).toBe(2);
  });
});

/* ---------------------------------------------------------------- mobility */

describe('mobility sessions', () => {
  it('validates duration and kind', async () => {
    await expect(service.logMobility({ kind: 'stretch', durationMin: 0 })).rejects.toMatchObject({
      fields: { durationMin: expect.any(String) },
    });
    await expect(
      service.logMobility({ kind: 'stretch', durationMin: 5_000 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('allows more than one session on the same day', async () => {
    await service.logMobility({ kind: 'stretch', durationMin: 10, logDate: '2026-03-01' });
    await service.logMobility({ kind: 'yoga', durationMin: 20, logDate: '2026-03-01' });

    const sessions = await repository.listMobilitySessions('2026-03-01', '2026-03-01');
    expect(sessions).toHaveLength(2);
  });

  it('rejects an out-of-range intensity', async () => {
    await expect(
      service.logMobility({ kind: 'yoga', durationMin: 20, intensity: 0 }),
    ).rejects.toMatchObject({ fields: { intensity: expect.any(String) } });
  });

  it('soft deletes a session', async () => {
    const session = await service.logMobility({ kind: 'yoga', durationMin: 30 });
    await service.removeMobility(session.id);
    expect(await repository.listMobilitySessions('2026-01-01', '2026-12-31')).toHaveLength(0);
  });

  it('totals minutes across a range', async () => {
    await service.logMobility({ kind: 'stretch', durationMin: 10, logDate: '2026-03-01' });
    await service.logMobility({ kind: 'yoga', durationMin: 25, logDate: '2026-03-02' });
    await service.logMobility({ kind: 'yoga', durationMin: 99, logDate: '2026-03-20' });

    expect(await repository.mobilityMinutes('2026-03-01', '2026-03-10')).toBe(35);
    expect(await repository.mobilityMinutes('2026-01-01', '2026-01-31')).toBe(0);
  });
});

describe('mobility maths', () => {
  it('formats minutes past an hour', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1h');
    expect(formatMinutes(70)).toBe('1h 10m');
    expect(formatMinutes(0)).toBe('0 min');
  });

  it('validates session minutes', () => {
    expect(validateSessionMinutes(30)).toBeNull();
    expect(validateSessionMinutes(0)).toMatch(/greater than zero/);
    expect(validateSessionMinutes(12.5)).toMatch(/whole minutes/);
  });

  it('summarises sessions per kind, largest first', () => {
    const summary = summariseMobility(
      [
        { logDate: '2026-03-01', kind: 'yoga', durationMin: 30 },
        { logDate: '2026-03-01', kind: 'yoga', durationMin: 10 },
        { logDate: '2026-03-02', kind: 'stretch', durationMin: 15 },
      ],
      14,
    );

    expect(summary.sessions).toBe(3);
    expect(summary.totalMinutes).toBe(55);
    expect(summary.activeDays).toBe(2);
    expect(summary.daysInRange).toBe(14);
    expect(summary.byKind[0]).toEqual({ kind: 'yoga', sessions: 2, minutes: 40 });
  });

  it('reports a null average for an empty range', () => {
    const summary = summariseMobility([], 14);
    expect(summary.sessions).toBe(0);
    expect(summary.averageMinutes).toBeNull();
    expect(isQuietRange([])).toBe(true);
    expect(isQuietRange([{ logDate: '2026-03-01' }])).toBe(false);
  });
});

/* ----------------------------------------------------------------- reports */

describe('recoveryReport', () => {
  it('splits the window and reports a trend per rating', async () => {
    // 14 days ending 2026-03-14. Recent half is the newer seven.
    for (const day of ['2026-03-09', '2026-03-10', '2026-03-11']) {
      await service.rateDay({ logDate: day, energy: 8 });
    }
    for (const day of ['2026-03-04', '2026-03-05', '2026-03-06']) {
      await service.rateDay({ logDate: day, energy: 4 });
    }

    const report = await service.recoveryReport('2026-03-14', 14);

    expect(report.dates).toHaveLength(14);
    expect(report.dates[0]).toBe('2026-03-14');
    expect(report.ratings.energy.current).toBe(8);
    expect(report.ratings.energy.previous).toBe(4);
    expect(report.ratings.energy.trend).toEqual({ delta: 4, direction: 'up' });
    // Never rated, so no trend is invented.
    expect(report.ratings.mood.current).toBeNull();
    expect(report.ratings.mood.trend).toBeNull();
  });

  it('counts coverage separately from the averages', async () => {
    await service.rateDay({ logDate: '2026-03-14', energy: 6 });

    const report = await service.recoveryReport('2026-03-14', 14);
    expect(report.ratedDays).toBe(1);
  });

  it('includes mobility summary for the same window', async () => {
    await service.logMobility({ kind: 'yoga', durationMin: 30, logDate: '2026-03-14' });

    const report = await service.recoveryReport('2026-03-14', 14);
    expect(report.mobility.sessions).toBe(1);
    expect(report.mobility.totalMinutes).toBe(30);
  });

  it('handles a single-day window without collapsing', async () => {
    await service.rateDay({ logDate: '2026-03-14', energy: 5 });

    const report = await service.recoveryReport('2026-03-14', 1);
    expect(report.dates).toEqual(['2026-03-14']);
    expect(report.ratings.energy.current).toBe(5);
  });

  it('returns an empty report rather than throwing on no data', async () => {
    const report = await service.recoveryReport('2026-03-14', 7);
    expect(report.logs).toEqual([]);
    expect(report.ratedDays).toBe(0);
    expect(report.ratings.energy.current).toBeNull();
    expect(report.mobility.sessions).toBe(0);
  });
});

describe('reportBounds', () => {
  it('spans exactly the requested number of days, inclusive', () => {
    expect(service.reportBounds('2026-03-14', 14)).toEqual({
      from: '2026-03-01',
      to: '2026-03-14',
    });
    expect(service.reportBounds('2026-03-14', 1)).toEqual({
      from: '2026-03-14',
      to: '2026-03-14',
    });
  });
});
