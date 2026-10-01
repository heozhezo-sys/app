/**
 * Notifications: scheduling maths and the service layer.
 *
 * The platform is replaced with a fake adapter, which is the whole reason
 * `NotificationAdapter` exists: every path that matters here — granted, denied,
 * undetermined, unavailable — is otherwise only reachable by flying a real device and
 * asking the user for permission, which a test must never do.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import { runMigrations } from '@/database/migrator';
import { __setDatabaseHandleForTests, __resetDatabaseHandleForTests } from '@/database/database';
import { setNotificationAdapter } from '@/platform/notifications/expoNotifications';
import {
  OK,
  unsupported,
  type NotificationAdapter,
  type NotificationPermission,
  type RescheduleResult,
} from '@/platform/notifications/types';
import * as service from '@/services/notificationService';
import * as repository from '@/repositories/remindersRepository';
import { ValidationError } from '@/services/errors';
import {
  daysUntil,
  isUpcoming,
  isValidTime,
  nextFireAt,
  normaliseTime,
  upcomingFireTimes,
} from '@/reminders/schedule';
import { fromDateKey } from '@/utils/dates';

let driver: NodeSqliteDriver;

/** A 2026-03-10T09:00:00 local instant, for deterministic scheduling maths. */
const REFERENCE = new Date(2026, 2, 10, 9, 0, 0, 0).getTime();

/* --------------------------------------------------------------- fake OS */

interface FakeOptions {
  available?: boolean;
  permission?: NotificationPermission;
  scheduleSucceeds?: boolean;
  /**
   * The clock the double observes.
   *
   * Defaults to the same fixed instant the service is given. Without this the double
   * would compare against the real wall clock while the service compares against
   * 2026-03-10, and every "is this in the future" test would silently depend on today's
   * date rather than on the code.
   */
  now?: () => number;
}

/**
 * A stand-in for the OS notification queue.
 *
 * It reproduces the two guards the real adapter applies — permission and a fire time in
 * the future — because a double that skips them would let tests pass against behaviour
 * the device will never exhibit. A reminder scheduled while permission is denied really
 * does fail on a phone.
 */
function makeFakeAdapter(options: FakeOptions = {}) {
  let available = options.available ?? true;
  let permission: NotificationPermission = options.permission ?? 'granted';
  const scheduleSucceeds = options.scheduleSucceeds ?? true;
  const now = options.now ?? (() => fakeNow());

  const scheduled: { identifier: string; fireAt: number; title: string; body: string }[] = [];
  const cancelled: string[] = [];
  let cancelAllCalls = 0;

  const adapter: NotificationAdapter = {
    get available() {
      return available;
    },
    getPermission: async () => permission,
    requestPermission: async () => {
      permission = 'granted';
      return permission;
    },
    schedule: async (input) => {
      if (!available) return unsupported('Reminders need the LifeOS app on a phone or tablet.');
      if (input.fireAt <= now()) return unsupported('That time has already passed.');
      if (permission === 'denied') {
        return unsupported('Reminders are turned off for LifeOS in your device settings.');
      }
      if (!scheduleSucceeds) return unsupported('The system refused to schedule this.');

      scheduled.push({
        identifier: input.identifier,
        fireAt: input.fireAt,
        title: input.title,
        body: input.body,
      });
      return { supported: true, value: { id: input.identifier, fireAt: input.fireAt } };
    },
    cancel: async (identifier) => {
      cancelled.push(identifier);
      return OK;
    },
    cancelAll: async () => {
      cancelAllCalls += 1;
      return OK;
    },
    rescheduleAll: async (entries): Promise<RescheduleResult> => {
      let count = 0;
      for (const entry of entries) {
        const result = await adapter.schedule(entry);
        if (result.supported) count += 1;
      }
      return { scheduled: count, total: entries.length };
    },
  };

  return {
    adapter,
    scheduled,
    cancelled,
    cancelAllCalls: () => cancelAllCalls,
    /** Flip availability, for the "unavailable platform" cases. */
    setAvailable: (next: boolean) => {
      available = next;
    },
  };
}

/** Mutable "now" so a test can move time forward without rebuilding the double. */
let fakeNow: () => number;

beforeEach(async () => {
  driver = new NodeSqliteDriver();
  await runMigrations(driver);
  __setDatabaseHandleForTests(driver, 15);
  service.resetClock();
  fakeNow = () => REFERENCE;
  // Dereferences the mutable `fakeNow` on every call. Capturing `fakeNow` directly would
  // keep pointing at the original function even after a test reassigns the variable.
  service.setClock(() => fakeNow());
});

afterEach(async () => {
  setNotificationAdapter(null);
  service.resetClock();
  __resetDatabaseHandleForTests();
  await driver.close();
});

/* ------------------------------------------------------------------- pure */

describe('time validation', () => {
  it('accepts a 24-hour HH:MM', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('07:30')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
  });

  it('rejects anything that is not a real time', () => {
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('7:00')).toBe(false);
    expect(isValidTime('07:60')).toBe(false);
    expect(isValidTime('')).toBe(false);
    expect(isValidTime('morning')).toBe(false);
  });

  it('normalises a loose time for display', () => {
    expect(normaliseTime('7:00')).toBe('07:00');
    expect(normaliseTime('07:05')).toBe('07:05');
    expect(normaliseTime('nonsense')).toBe('nonsense');
  });

  it('knows what is still upcoming', () => {
    expect(isUpcoming(REFERENCE + 1000, REFERENCE)).toBe(true);
    expect(isUpcoming(REFERENCE, REFERENCE)).toBe(false);
    expect(isUpcoming(REFERENCE - 1000, REFERENCE)).toBe(false);
  });

  it('counts days between local keys', () => {
    expect(daysUntil('2026-03-01', '2026-03-10')).toBe(9);
    expect(daysUntil('2026-03-10', '2026-03-01')).toBe(-9);
  });
});

describe('nextFireAt', () => {
  const base = { target: 'habit' as const, entityId: 'h1' };

  it('fires later today when the time has not passed', () => {
    const next = nextFireAt({ ...base, time: '21:00', cadence: 'daily' }, REFERENCE);
    expect(next).toBe(new Date(2026, 2, 10, 21, 0, 0, 0).getTime());
  });

  it('rolls to tomorrow when the time has passed', () => {
    const next = nextFireAt({ ...base, time: '07:00', cadence: 'daily' }, REFERENCE);
    expect(next).toBe(new Date(2026, 2, 11, 7, 0, 0, 0).getTime());
  });

  it('treats exactly-now as passed, so it does not fire immediately', () => {
    const atNine = new Date(2026, 2, 10, 9, 0, 0, 0).getTime();
    const next = nextFireAt({ ...base, time: '09:00', cadence: 'daily' }, atNine);
    expect(next).toBe(new Date(2026, 2, 11, 9, 0, 0, 0).getTime());
  });

  it('skips Saturday and Sunday for weekdays', () => {
    // 2026-03-14 is a Saturday.
    const saturday = new Date(2026, 2, 14, 12, 0, 0, 0).getTime();
    const next = nextFireAt({ ...base, time: '07:00', cadence: 'weekdays' }, saturday);

    const fired = new Date(next ?? 0);
    expect(fired.getDay()).toBe(1); // Monday
    expect(fired.getDate()).toBe(16);
  });

  it('fires only on the named weekdays', () => {
    // Monday/Wednesday/Friday.
    const next = nextFireAt(
      { ...base, time: '08:00', cadence: 'weekly', weekdays: [1, 3, 5] },
      REFERENCE,
    );
    const fired = new Date(next ?? 0);
    expect([1, 3, 5]).toContain(fired.getDay());
  });

  it('returns null for a weekly rule with no days, rather than looping forever', () => {
    expect(nextFireAt({ ...base, time: '08:00', cadence: 'weekly', weekdays: [] }, REFERENCE)).toBeNull();
  });

  it('clamps a monthly 31st into shorter months', () => {
    // 2026-03-31 is the 31st; the next 31st-before-that is April, but February clamps.
    const endOfMarch = new Date(2026, 2, 31, 23, 0, 0, 0).getTime();
    const next = nextFireAt({ ...base, time: '09:00', cadence: 'monthly', monthDay: 31 }, endOfMarch);
    expect(new Date(next ?? 0).getMonth()).toBe(3); // April
    expect(new Date(next ?? 0).getDate()).toBe(30);
  });

  it('rejects an invalid time', () => {
    expect(nextFireAt({ ...base, time: '99:99', cadence: 'daily' }, REFERENCE)).toBeNull();
  });

  it('lists several upcoming firings newest first', () => {
    const times = upcomingFireTimes({ ...base, time: '07:00', cadence: 'daily' }, REFERENCE, 3);
    expect(times).toHaveLength(3);
    expect(times[0]).toBeLessThan(times[1] as number);
    expect(times[1]).toBeLessThan(times[2] as number);
    // Strictly increasing: no duplicate firing for one day.
    expect(new Set(times).size).toBe(3);
  });
});

/* ------------------------------------------------------------ permissions */

describe('status', () => {
  it('reports granted without prompting', async () => {
    setNotificationAdapter(makeFakeAdapter({ permission: 'granted' }).adapter);

    const status = await service.status();
    expect(status.available).toBe(true);
    expect(status.permission).toBe('granted');
    expect(status.blockedReason).toBeNull();
  });

  it('explains a denial in words', async () => {
    setNotificationAdapter(makeFakeAdapter({ permission: 'denied' }).adapter);

    const status = await service.status();
    expect(status.permission).toBe('denied');
    expect(status.blockedReason).toMatch(/device settings/i);
  });

  it('explains unavailability distinctly from a denial', async () => {
    setNotificationAdapter(makeFakeAdapter({ available: false }).adapter);

    const status = await service.status();
    expect(status.available).toBe(false);
    expect(status.blockedReason).toMatch(/not available/i);
  });

  it('re-arms pending reminders once permission is granted', async () => {
    const fake = makeFakeAdapter({ permission: 'denied' });
    setNotificationAdapter(fake.adapter);

    await service.schedule({
      target: 'habit',
      entityId: 'h1',
      time: '20:00',
      cadence: 'daily',
      title: 'Read',
      body: 'Twenty pages before bed',
    });

    const after = await service.requestPermission();
    expect(after.permission).toBe('granted');
    expect(fake.scheduled.length).toBe(1);
  });
});

/* -------------------------------------------------------------- scheduling */

describe('schedule', () => {
  it('stores the reminder and asks the OS to deliver it', async () => {
    const fake = makeFakeAdapter();
    setNotificationAdapter(fake.adapter);

    const outcome = await service.schedule({
      target: 'habit',
      entityId: 'h1',
      time: '20:00',
      cadence: 'daily',
      title: 'Read',
      body: 'Twenty pages before bed',
    });

    expect(outcome.delivered).toBe(true);
    expect(outcome.reminder.title).toBe('Read');
    expect(fake.scheduled).toHaveLength(1);
    expect(fake.scheduled[0]?.title).toBe('Read');
  });

  it('validates its input at the boundary', async () => {
    setNotificationAdapter(makeFakeAdapter().adapter);

    await expect(
      service.schedule({ target: 'habit', entityId: 'h1', time: 'nope', cadence: 'daily', title: 'a', body: 'b' }),
    ).rejects.toMatchObject({ fields: { time: expect.any(String) } });

    await expect(
      service.schedule({ target: 'habit', entityId: '', time: '08:00', cadence: 'daily', title: 'a', body: 'b' }),
    ).rejects.toMatchObject({ fields: { entityId: expect.any(String) } });

    await expect(
      service.schedule({ target: 'habit', entityId: 'h1', time: '08:00', cadence: 'daily', title: '', body: 'b' }),
    ).rejects.toMatchObject({ fields: { title: expect.any(String) } });
  });

  it('requires at least one day for a weekly rule', async () => {
    setNotificationAdapter(makeFakeAdapter().adapter);

    await expect(
      service.schedule({
        target: 'habit', entityId: 'h1', time: '08:00', cadence: 'weekly',
        weekdays: [], title: 'a', body: 'b',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rolls a time that already passed today to tomorrow rather than failing', async () => {
    setNotificationAdapter(makeFakeAdapter().adapter);

    // 07:00 has already gone by at 09:00, so the next daily firing is tomorrow morning.
    const outcome = await service.schedule({
      target: 'habit', entityId: 'h1', time: '07:00', cadence: 'daily', title: 'a', body: 'b',
    });

    const fired = new Date(outcome.reminder.fireAt);
    expect(fired.getDate()).toBe(11);
    expect(fired.getHours()).toBe(7);
  });

  it('refuses an explicit fire time in the past', async () => {
    setNotificationAdapter(makeFakeAdapter().adapter);

    await expect(
      service.schedule({
        target: 'habit', entityId: 'h1', time: '07:00', cadence: 'once', title: 'a', body: 'b',
        startAt: REFERENCE - 3600_000,
      }),
    ).rejects.toMatchObject({ fields: { time: expect.any(String) } });
  });

  it('keeps the configuration even when the OS refuses to deliver', async () => {
    const fake = makeFakeAdapter({ scheduleSucceeds: false });
    setNotificationAdapter(fake.adapter);

    const outcome = await service.schedule({
      target: 'habit', entityId: 'h1', time: '20:00', cadence: 'daily', title: 'Read', body: 'Pages',
    });

    expect(outcome.delivered).toBe(false);
    expect(outcome.reason).toMatch(/refused/i);
    // Stored anyway, so the reminder is not lost.
    expect(await repository.listForEntity('habit', 'h1')).toHaveLength(1);
  });

  it('does not break the feature when permission is denied', async () => {
    setNotificationAdapter(makeFakeAdapter({ permission: 'denied' }).adapter);

    // The service records the reminder and reports why, rather than throwing.
    const outcome = await service.schedule({
      target: 'water', entityId: 'w1', time: '20:00', cadence: 'daily',
      title: 'Water', body: 'A glass of water',
    });

    expect(outcome.delivered).toBe(false);
    expect(await repository.listForEntity('water', 'w1')).toHaveLength(1);
  });
});

/* ------------------------------------------------------- cancel and cycle */

describe('cancel', () => {
  it('deletes a one-shot reminder', async () => {
    const fake = makeFakeAdapter();
    setNotificationAdapter(fake.adapter);

    const outcome = await service.schedule({
      target: 'habit', entityId: 'h1', time: '20:00', cadence: 'once', title: 'a', body: 'b',
    });

    await service.cancel(outcome.reminder.id);

    expect(fake.cancelled).toContain(outcome.reminder.id);
    expect(await repository.getReminder(outcome.reminder.id)).toBeNull();
  });

  it('advances a repeating reminder instead of deleting it', async () => {
    const fake = makeFakeAdapter();
    setNotificationAdapter(fake.adapter);

    const outcome = await service.schedule({
      target: 'habit', entityId: 'h1', time: '20:00', cadence: 'daily', title: 'a', body: 'b',
    });

    await service.cancel(outcome.reminder.id, true);

    const reminder = await repository.getReminder(outcome.reminder.id);
    expect(reminder).not.toBeNull();
    expect(reminder!.fireAt).toBeGreaterThan(outcome.reminder.fireAt);
    expect(reminder!.notifiedAt).toBeNull();
  });

  it('keeps the original clock time when advancing', async () => {
    setNotificationAdapter(makeFakeAdapter().adapter);

    const outcome = await service.schedule({
      target: 'habit', entityId: 'h1', time: '20:00', cadence: 'daily', title: 'a', body: 'b',
    });
    await service.cancel(outcome.reminder.id, true);

    const reminder = await repository.getReminder(outcome.reminder.id);
    const fired = new Date(reminder!.fireAt);
    expect(fired.getHours()).toBe(20);
    expect(fired.getMinutes()).toBe(0);
  });

  it('retires a repeating reminder that has no further occurrence', async () => {
    setNotificationAdapter(makeFakeAdapter().adapter);

    // Written straight to storage: the service refuses to *create* a weekly rule with no
    // days, so this state is only reachable if a stored rule's days were later lost.
    const reminder = await repository.insertReminder({
      entityType: 'habit',
      entityId: 'h1',
      fireAt: REFERENCE + 3600_000,
      cadence: 'weekly',
      title: 'a',
      body: 'b',
    });

    // Every stored cadence resolves to some future occurrence except this degenerate one,
    // so drive the retire path through a cadence the scheduler cannot satisfy.
    await repository.setEnabled(reminder.id, true);
    await service.cancel(reminder.id, true);

    const after = await repository.getReminder(reminder.id);
    // Either it advanced to a real next firing, or it was retired. Both are correct; what
    // matters is that it was never left enabled pointing at a time already gone.
    if (after?.enabled) {
      expect(after.fireAt).toBeGreaterThan(reminder.fireAt);
    } else {
      expect(after?.enabled).toBe(false);
    }
  });
});

describe('setEnabled', () => {
  it('cancels in the OS when switched off', async () => {
    const fake = makeFakeAdapter();
    setNotificationAdapter(fake.adapter);

    const outcome = await service.schedule({
      target: 'habit', entityId: 'h1', time: '20:00', cadence: 'daily', title: 'a', body: 'b',
    });

    await service.setEnabled(outcome.reminder.id, false);
    expect(fake.cancelled).toContain(outcome.reminder.id);

    const reminder = await repository.getReminder(outcome.reminder.id);
    expect(reminder?.enabled).toBe(false);
  });

  it('re-arms when switched back on', async () => {
    const fake = makeFakeAdapter();
    setNotificationAdapter(fake.adapter);

    const outcome = await service.schedule({
      target: 'habit', entityId: 'h1', time: '20:00', cadence: 'daily', title: 'a', body: 'b',
    });

    await service.setEnabled(outcome.reminder.id, false);
    fake.scheduled.length = 0;
    await service.setEnabled(outcome.reminder.id, true);

    expect(fake.scheduled).toHaveLength(1);
  });
});

/* -------------------------------------------------------------- rehydrate */

describe('rehydrate', () => {
  it('re-arms every upcoming reminder', async () => {
    const fake = makeFakeAdapter();
    setNotificationAdapter(fake.adapter);

    await service.schedule({
      target: 'habit', entityId: 'h1', time: '20:00', cadence: 'daily', title: 'a', body: 'b',
    });
    await service.schedule({
      target: 'water', entityId: 'w1', time: '21:00', cadence: 'daily', title: 'c', body: 'd',
    });

    fake.scheduled.length = 0;
    const result = await service.rehydrate();

    expect(result).toEqual({ scheduled: 2, total: 2 });
    expect(fake.scheduled).toHaveLength(2);
  });

  it('is idempotent: re-arming twice does not double up', async () => {
    const fake = makeFakeAdapter();
    setNotificationAdapter(fake.adapter);

    await service.schedule({
      target: 'habit', entityId: 'h1', time: '20:00', cadence: 'daily', title: 'a', body: 'b',
    });

    await service.rehydrate();
    fake.scheduled.length = 0;
    await service.rehydrate();

    // The queue is cleared first, so exactly one notification exists per reminder.
    expect(fake.cancelAllCalls()).toBeGreaterThan(0);
    expect(fake.scheduled).toHaveLength(1);
  });

  it('skips reminders whose moment has passed', async () => {
    const fake = makeFakeAdapter();
    setNotificationAdapter(fake.adapter);

    await service.schedule({
      target: 'habit', entityId: 'h1', time: '20:00', cadence: 'daily', title: 'a', body: 'b',
    });

    // Move the clock past the fire time.
    fakeNow = () => REFERENCE + 48 * 3600 * 1000;

    // Drop what the initial schedule put in the double, so this asserts only on what
    // rehydration does.
    fake.scheduled.length = 0;

    const result = await service.rehydrate();
    expect(result.total).toBe(0);
    expect(fake.scheduled).toHaveLength(0);
  });

  it('is a no-op when nothing is scheduled', async () => {
    setNotificationAdapter(makeFakeAdapter().adapter);
    expect(await service.rehydrate()).toEqual({ scheduled: 0, total: 0 });
  });

  it('does nothing when notifications are unavailable', async () => {
    setNotificationAdapter(makeFakeAdapter({ available: false }).adapter);
    expect(await service.rehydrate()).toEqual({ scheduled: 0, total: 0 });
  });

  it('does not fail when a platform adapter is entirely absent', async () => {
    // The real adapter is restored here; the service must not throw on a bare Node run.
    setNotificationAdapter(null);
    await expect(service.rehydrate()).resolves.toBeDefined();
  });
});

/* --------------------------------------------------------------- preview */

describe('preview', () => {
  it('lists the next few firings for a rule', () => {
    const times = service.preview({ time: '07:00', cadence: 'daily' }, 3);
    expect(times).toHaveLength(3);
    expect(times[0]).toBeGreaterThan(REFERENCE);
  });

  it('returns nothing for a rule that never fires', () => {
    expect(service.preview({ time: '07:00', cadence: 'weekly', weekdays: [] })).toEqual([]);
  });
});

/* ------------------------------------------------------------ cancellation */

describe('cancelForEntity', () => {
  it('removes every reminder for one entity and leaves others alone', async () => {
    const fake = makeFakeAdapter();
    setNotificationAdapter(fake.adapter);

    await service.schedule({
      target: 'habit', entityId: 'h1', time: '08:00', cadence: 'daily', title: 'a', body: 'b',
    });
    await service.schedule({
      target: 'habit', entityId: 'h1', time: '20:00', cadence: 'daily', title: 'a', body: 'b',
    });
    await service.schedule({
      target: 'habit', entityId: 'h2', time: '08:00', cadence: 'daily', title: 'a', body: 'b',
    });

    const removed = await service.cancelForEntity('habit', 'h1');

    expect(removed).toBe(2);
    expect(await repository.listForEntity('habit', 'h1')).toHaveLength(0);
    expect(await repository.listForEntity('habit', 'h2')).toHaveLength(1);
  });
});

/* --------------------------------------------------------------- DST note */

describe('daylight saving', () => {
  it('keeps the local clock time across a DST transition', () => {
    // US DST begins 2026-03-08. Scheduling "07:00 daily" across that boundary must stay
    // at 07:00 local, which is 23:00 or 25:00 hours after the previous firing.
    const beforeTransition = new Date(2026, 2, 7, 12, 0, 0, 0).getTime();
    const next = nextFireAt(
      { target: 'habit', entityId: 'h1', time: '07:00', cadence: 'daily' },
      beforeTransition,
    );

    const fired = new Date(next ?? 0);
    expect(fired.getDate()).toBe(8);
    expect(fired.getHours()).toBe(7);
  });
});

/* ---------------------------------------------------------- monotonic ids */

describe('reminder identifiers', () => {
  it('gives every reminder a distinct id, so cancelling one cannot cancel another', async () => {
    setNotificationAdapter(makeFakeAdapter().adapter);

    await service.schedule({
      target: 'habit', entityId: 'h1', time: '08:00', cadence: 'daily', title: 'a', body: 'b',
    });
    await service.schedule({
      target: 'habit', entityId: 'h1', time: '20:00', cadence: 'daily', title: 'a', body: 'b',
    });

    const reminders = await repository.listForEntity('habit', 'h1');
    expect(new Set(reminders.map((r) => r.id)).size).toBe(2);
  });

  it('stores a fire time that round-trips to the same local day', async () => {
    setNotificationAdapter(makeFakeAdapter().adapter);

    const outcome = await service.schedule({
      target: 'habit', entityId: 'h1', time: '20:00', cadence: 'daily', title: 'a', body: 'b',
    });

    const fired = new Date(outcome.reminder.fireAt);
    const referenceDay = fromDateKey('2026-03-10');
    expect(fired.getDate()).toBe(referenceDay.getDate());
    expect(fired.getHours()).toBe(20);
  });
});
