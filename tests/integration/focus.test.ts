/**
 * Focus sessions and reviews, end to end through service -> repository -> real SQLite.
 *
 * Time is injected rather than waited for. The cases that matter are the ones a user
 * hits without meaning to: the app being killed mid-session, a timer still running after
 * reopening, a second timer being started by mistake, and a session abandoned and
 * restarted. Each is simulated deterministically here.
 */

import { NodeSqliteDriver } from '../support/nodeSqliteDriver';
import {
  __resetDatabaseHandleForTests,
  __setDatabaseHandleForTests,
} from '@/database/database';
import { runMigrations } from '@/database/migrator';
import { LATEST_SCHEMA_VERSION } from '@/database/migrations/types';
import * as focus from '@/services/focusService';
import { ValidationError } from '@/services/errors';

let driver: NodeSqliteDriver;

/** A clock the test moves by hand. */
let now = 1_767_225_600_000; // 2026-01-01T00:00:00Z

function advance(ms: number): void {
  now += ms;
}

const MINUTE = 60_000;

beforeEach(async () => {
  driver = new NodeSqliteDriver();
  await runMigrations(driver);
  __setDatabaseHandleForTests(driver, LATEST_SCHEMA_VERSION);
  now = 1_767_225_600_000;
  focus.setClock(() => now);
});

afterEach(async () => {
  focus.resetClock();
  __resetDatabaseHandleForTests();
  await driver.close();
});

/** Starts a session, failing the test rather than returning an error result. */
async function startSession(input: Parameters<typeof focus.startSession>[0] = {}) {
  const result = await focus.startSession(input);
  if (!result.ok) throw new Error(`expected a session to start: ${JSON.stringify(result.error)}`);
  return result.session;
}

describe('starting a session', () => {
  it('stores a wall-clock deadline, not a remaining-tick count', async () => {
    const session = await startSession({ focusMinutes: 25, breakMinutes: 5 });

    expect(session.status).toBe('active');
    expect(session.startedAt).toBe(now);
    // The deadline is the whole mechanism: the timer is this value minus the clock.
    expect(session.endsAt).toBe(now + 25 * MINUTE);
    expect(session.plannedMin).toBe(25);
    expect(session.breakMin).toBe(5);
  });

  it('counts down correctly with no app running in between', async () => {
    await startSession({ focusMinutes: 25 });

    // Nothing is called for ten minutes; the app is suspended.
    advance(10 * MINUTE);
    const view = await focus.getActiveView();

    expect(view?.timer.remainingMs).toBe(15 * MINUTE);
    expect(view?.timer.expired).toBe(false);
  });

  it('refuses a second session while one is running', async () => {
    await startSession({ focusMinutes: 25 });

    const second = await focus.startSession({ focusMinutes: 50 });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe('already_running');
    // The running timer is untouched, not replaced.
    expect((await focus.getActiveView())?.session.plannedMin).toBe(25);
  });

  it('allows a new session once the previous one is resolved', async () => {
    const first = await startSession({ focusMinutes: 25 });
    await focus.completeSession(first.id);

    expect((await focus.startSession({ focusMinutes: 50 })).ok).toBe(true);
  });

  it('rejects an invalid length with a named field', async () => {
    const result = await focus.startSession({ kind: 'custom', focusMinutes: 0 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid');
    if (result.error.kind !== 'invalid') return;
    expect(result.error.field).toBe('focusMinutes');
  });

  it('stores label and intent as absent rather than empty strings', async () => {
    const session = await startSession({ label: '   ', intent: 'Write the plan' });

    expect(session.label).toBeNull();
    expect(session.intent).toBe('Write the plan');
  });

  it('numbers the cycle from the sessions completed today', async () => {
    const first = await startSession();
    await focus.completeSession(first.id);

    expect((await startSession()).cycleIndex).toBe(2);
  });

  it('links a session to a task and a goal', async () => {
    const session = await startSession({ taskId: 'task-1', goalId: 'goal-1' });

    expect(session.taskId).toBe('task-1');
    expect(session.goalId).toBe('goal-1');
  });
});
describe('completing a session', () => {
  it('records the real elapsed time when completed early', async () => {
    const session = await startSession({ focusMinutes: 25 });

    advance(8 * MINUTE);
    const done = await focus.completeSession(session.id);

    expect(done?.status).toBe('completed');
    // Eight minutes of real work, not the full 25.
    expect(done?.actualSec).toBe(8 * 60);
  });

  it('caps actual time at the planned length when completed late', async () => {
    const session = await startSession({ focusMinutes: 25 });

    // The app was closed and the user came back hours later.
    advance(4 * 60 * MINUTE);
    const done = await focus.completeSession(session.id);

    expect(done?.actualSec).toBe(25 * 60);
  });

  it('is a no-op for a session that is already resolved', async () => {
    const session = await startSession();
    await focus.completeSession(session.id);

    expect(await focus.completeSession(session.id)).toBeNull();
  });

  it('is a no-op for a session that does not exist', async () => {
    expect(await focus.completeSession('no-such-session')).toBeNull();
  });
});

describe('abandoning a session', () => {
  it('records the partial time rather than discarding it', async () => {
    const session = await startSession({ focusMinutes: 25 });

    advance(3 * MINUTE);
    const stopped = await focus.abandonSession(session.id);

    expect(stopped?.status).toBe('abandoned');
    expect(stopped?.actualSec).toBe(3 * 60);
  });

  it('frees the slot so a new session can start', async () => {
    const session = await startSession();
    await focus.abandonActive();

    expect((await focus.startSession())?.ok).toBe(true);
    expect((await focus.getActiveView())?.session.id).not.toBe(session.id);
  });

  it('is a no-op when nothing is running', async () => {
    expect(await focus.abandonActive()).toBeNull();
  });
});

describe('recovery after the app was killed', () => {
  it('leaves a running session alone when it still has time', async () => {
    const session = await startSession({ focusMinutes: 25 });

    advance(5 * MINUTE);
    // Relaunch mid-session: nothing should be resolved.
    expect(await focus.recoverStaleSession()).toBeNull();
    expect((await focus.getActiveView())?.session.id).toBe(session.id);
  });

  it('resolves a session whose deadline passed while the app was closed', async () => {
    await startSession({ focusMinutes: 25 });

    // The process is killed. The user reopens the app an hour later.
    advance(60 * MINUTE);
    const recovered = await focus.recoverStaleSession();

    // Recorded as completed: the user did run it, the app just never saw it end.
    expect(recovered?.status).toBe('completed');
    expect(recovered?.actualSec).toBe(25 * 60);
  });

  it('frees the single-session slot after recovery', async () => {
    await startSession({ focusMinutes: 25 });
    advance(60 * MINUTE);
    await focus.recoverStaleSession();

    // Without recovery the stale session would block every future timer.
    expect(await focus.getActiveView()).toBeNull();
    expect((await focus.startSession({ focusMinutes: 50 })).ok).toBe(true);
  });

  it('does nothing when there is no session', async () => {
    expect(await focus.recoverStaleSession()).toBeNull();
  });

  it('is safe to run twice', async () => {
    await startSession({ focusMinutes: 25 });
    advance(60 * MINUTE);

    await focus.recoverStaleSession();
    // A second launch must not double-count or fail.
    expect(await focus.recoverStaleSession()).toBeNull();
  });
});

describe('focus totals', () => {
  it("derives today's totals from stored sessions", async () => {
    const first = await startSession({ focusMinutes: 25 });
    advance(5 * MINUTE);
    await focus.completeSession(first.id);

    const second = await startSession({ focusMinutes: 50 });
    advance(2 * MINUTE);
    await focus.abandonSession(second.id);

    expect(await focus.todayTotals()).toEqual({
      completed: 1,
      abandoned: 1,
      focusMinutes: 7,
    });
  });

  it('reports nothing when no sessions have run', async () => {
    expect(await focus.todayTotals()).toEqual({ completed: 0, abandoned: 0, focusMinutes: 0 });
  });
});

describe('reviews', () => {
  it('saves a daily review against today', async () => {
    const review = await focus.saveReview({
      periodType: 'daily',
      body: 'Shipped the importer.',
      wins: 'Finished the two-phase import',
      moodScore: 8,
    });

    expect(review.body).toBe('Shipped the importer.');
    expect(review.moodScore).toBe(8);
    expect(review.periodKey).toBe('2026-01-01');
  });

  it('replaces the review for a period rather than duplicating it', async () => {
    await focus.saveReview({ periodType: 'daily', body: 'First draft' });
    const second = await focus.saveReview({ periodType: 'daily', body: 'Second draft' });

    expect(second.body).toBe('Second draft');
    expect(await focus.listReviews()).toHaveLength(1);
  });

  it('uses the ISO week for a weekly review', async () => {
    const review = await focus.saveReview({
      periodType: 'weekly',
      date: '2026-01-08',
      body: 'A good week.',
    });

    // A key a reader would recognise, not a row offset that shifts each year.
    expect(review.periodKey).toBe('2026-W02');
  });

  it('uses the month and year for longer periods', async () => {
    const monthly = await focus.saveReview({
      periodType: 'monthly', date: '2026-03-09', body: 'March.',
    });
    const yearly = await focus.saveReview({
      periodType: 'yearly', date: '2026-03-09', body: 'The year.',
    });

    expect(monthly.periodKey).toBe('2026-03');
    expect(yearly.periodKey).toBe('2026');
  });

  it('rejects an empty body', async () => {
    await expect(
      focus.saveReview({ periodType: 'daily', body: '   ' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a mood score outside one to ten', async () => {
    await expect(
      focus.saveReview({ periodType: 'daily', body: 'ok', moodScore: 11 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      focus.saveReview({ periodType: 'daily', body: 'ok', moodScore: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts a review without a mood score', async () => {
    const review = await focus.saveReview({ periodType: 'daily', body: 'ok' });
    expect(review.moodScore).toBeNull();
  });

  it('reads back the review for a period', async () => {
    await focus.saveReview({ periodType: 'daily', date: '2026-01-02', body: 'Saved.' });

    expect((await focus.getReview('daily', '2026-01-02'))?.body).toBe('Saved.');
    expect(await focus.getReview('daily', '2026-01-03')).toBeNull();
  });

  it('removes a review', async () => {
    const review = await focus.saveReview({ periodType: 'daily', body: 'Temporary.' });
    await focus.removeReview(review.id);

    expect(await focus.listReviews()).toHaveLength(0);
  });
});
