/**
 * Notification use cases.
 *
 * `FEATURES/NOTIFICATIONS.md` is the contract:
 *
 *  - "Use local notifications for habits, workouts, water, reading, focus and goal
 *     deadlines." — every one of those is a `ReminderTarget` here.
 *  - "Allow per-feature permission and schedule controls." — a reminder is per entity and
 *    per target, so switching one off never touches another.
 *  - "Notifications must not require a server." — nothing here has a network path.
 *  - "Handle denied permission without breaking the feature." — a denied permission is a
 *    returned reason, never a thrown error. Scheduling simply does not happen and the
 *    caller learns why.
 *
 * The platform is reached only through `NotificationAdapter`, so this file contains no
 * `Platform.OS` branch and is identical on iOS and Android.
 */

import * as repository from '@/repositories/remindersRepository';
import type { ReminderWithText } from '@/repositories/remindersRepository';
import { getNotificationAdapter } from '@/platform/notifications/expoNotifications';
import {
  describePermission,
  type NotificationPermission,
} from '@/platform/notifications/types';
import { ValidationError } from '@/services/errors';
import {
  REMINDER_CADENCES,
  REMINDER_TARGETS,
  isUpcoming,
  isValidTime,
  nextFireAt,
  normaliseTime,
  upcomingFireTimes,
  type ReminderCadence,
  type ReminderSpec,
  type ReminderTarget,
} from '@/reminders/schedule';
import { logger } from '@/utils/logger';

/** Injectable clock, so "is this still in the future?" is deterministic in tests. */
export type Clock = () => number;

let clock: Clock = () => Date.now();

export function setClock(next: Clock): void {
  clock = next;
}

export function resetClock(): void {
  clock = () => Date.now();
}

function now(): number {
  return clock();
}

/* -------------------------------------------------------------- permissions */

export interface NotificationStatus {
  /** Whether the OS supports local notifications here at all. */
  available: boolean;
  permission: NotificationPermission;
  /** Why reminders are unavailable, in words, or null when they are fine. */
  blockedReason: string | null;
  /** How many reminders are currently switched on locally. */
  enabledCount: number;
}

/**
 * Current reminder capability, without prompting.
 *
 * Never asks: a screen that merely reads status must not surprise the user with a
 * system dialog.
 */
export async function status(): Promise<NotificationStatus> {
  const adapter = getNotificationAdapter();
  const permission = await adapter.getPermission();

  return {
    available: adapter.available,
    permission,
    blockedReason: adapter.available ? describePermission(permission) : 'Reminders are not available on this device.',
    enabledCount: await repository.countEnabled(),
  };
}

/**
 * Asks the OS for permission.
 *
 * Call this only from a deliberate user action — enabling reminders in Settings, or
 * creating the first reminder for a feature. The returned state is reported honestly;
 * a refusal is an expected outcome, not an error.
 */
export async function requestPermission(): Promise<NotificationStatus> {
  const adapter = getNotificationAdapter();
  if (!adapter.available) return status();

  const permission = await adapter.requestPermission();
  if (permission === 'granted') {
    // Newly granted: put everything the user had already configured back into the OS,
    // because it was skipped while permission was missing.
    await rehydrate();
  }
  return status();
}

/* --------------------------------------------------------------- scheduling */

export interface ScheduleReminderInput {
  target: ReminderTarget;
  entityId: string;
  /** Local `HH:MM`. */
  time: string;
  cadence: ReminderCadence;
  /** Required for `weekly`. 0 = Sunday. */
  weekdays?: readonly number[];
  /** 1-31, for `monthly`. Clamped to the month's length when it fires. */
  monthDay?: number;
  title: string;
  body: string;
  /** Absolute first fire. Defaults to the next occurrence from now. */
  startAt?: number;
}

function validateInput(input: ScheduleReminderInput): FieldErrorsLike {
  const errors: FieldErrorsLike = {};

  if (!REMINDER_TARGETS.includes(input.target)) errors.target = 'Unknown reminder type.';
  if (!input.entityId || input.entityId.trim() === '') {
    errors.entityId = 'A reminder must belong to something.';
  }
  if (!isValidTime(input.time)) errors.time = 'Use HH:MM on a 24-hour clock.';
  if (!REMINDER_CADENCES.includes(input.cadence)) errors.cadence = 'Choose how often.';

  if (input.cadence === 'weekly') {
    const days = input.weekdays ?? [];
    if (days.length === 0) errors.weekdays = 'Choose at least one day.';
    else if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      errors.weekdays = 'Days must be 0 (Sunday) to 6 (Saturday).';
    }
  }

  if (input.cadence === 'monthly') {
    const day = input.monthDay ?? 1;
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      errors.monthDay = 'Choose a day between 1 and 31.';
    }
  }

  if (!input.title || input.title.trim() === '') errors.title = 'A reminder needs a title.';
  if (!input.body || input.body.trim() === '') errors.body = 'A reminder needs some text.';

  return errors;
}

type FieldErrorsLike = Partial<Record<string, string>>;

/**
 * Schedules a local reminder and records it locally.
 *
 * The local row is written **first**, so the user's configuration survives even if the OS
 * refuses the schedule. That ordering matters after a permission denial: the reminder is
 * not lost, it simply waits, and `rehydrate` installs it as soon as permission is granted.
 */
export async function schedule(input: ScheduleReminderInput): Promise<ScheduleOutcome> {
  const errors = validateInput(input);
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const time = normaliseTime(input.time);
  const spec: ReminderSpec = {
    target: input.target,
    entityId: input.entityId,
    time,
    cadence: input.cadence,
    ...(input.weekdays ? { weekdays: input.weekdays } : {}),
    ...(input.monthDay !== undefined ? { monthDay: input.monthDay } : {}),
  };

  const fireAt = input.startAt ?? nextFireAt(spec, now());
  if (fireAt === null) {
    throw new ValidationError({ cadence: 'That schedule never comes round. Check the days.' });
  }
  if (!isUpcoming(fireAt, now())) {
    throw new ValidationError({ time: 'That time has already passed today.' });
  }

  const reminder = await repository.insertReminder({
    entityType: input.target,
    entityId: input.entityId,
    fireAt,
    cadence: input.cadence,
    title: input.title.trim(),
    body: input.body.trim(),
  });

  const result = await deliver(reminder);
  return {
    reminder,
    delivered: result.supported,
    reason: result.supported ? null : result.reason,
  };
}

export interface ScheduleOutcome {
  reminder: ReminderWithText;
  /** False when the OS declined, most often because permission is missing. */
  delivered: boolean;
  reason: string | null;
}

/** Pushes one stored reminder into the OS queue. */
async function deliver(
  reminder: ReminderWithText,
): Promise<{ supported: true } | { supported: false; reason: string }> {
  const adapter = getNotificationAdapter();
  const result = await adapter.schedule({
    title: reminder.title,
    body: reminder.body,
    fireAt: reminder.fireAt,
    identifier: reminder.id,
  });

  if (result.supported) return { supported: true };
  logger.warn(`Reminder ${reminder.id} not scheduled: ${result.reason}`);
  return { supported: false, reason: result.reason };
}

/**
 * Cancels a reminder, both locally and in the OS.
 *
 * A recurring reminder also advances to its next occurrence rather than being deleted, so
 * turning off one firing does not end a daily habit's reminders.
 */
export async function cancel(reminderId: string, repeat = false): Promise<void> {
  const adapter = getNotificationAdapter();
  await adapter.cancel(reminderId);

  if (!repeat) {
    await repository.deleteReminder(reminderId);
    return;
  }

  const reminder = await repository.getReminder(reminderId);
  if (!reminder) return;

  if (reminder.cadence === null || reminder.cadence === 'once') {
    await repository.markNotified(reminderId);
    return;
  }

  const next = nextFireAt(
    {
      target: reminder.entityType,
      entityId: reminder.entityId,
      // The stored `fire_at` is an instant; recover the local time of day from it so the
      // recurrence keeps firing at the clock time the user chose, not at "now plus a day".
      time: localTimeOf(reminder.fireAt),
      cadence: reminder.cadence,
    },
    reminder.fireAt,
  );

  if (next === null) {
    // No further occurrence: retire it instead of leaving a rule that cannot fire.
    await repository.setEnabled(reminderId, false);
    return;
  }

  const advanced = await repository.advanceReminder(reminderId, next);
  if (advanced) await deliver(advanced);
}

/** `HH:MM` for an epoch ms, in local time. */
function localTimeOf(epochMs: number): string {
  const date = new Date(epochMs);
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** Switches one reminder on or off without deleting it. */
export async function setEnabled(reminderId: string, enabled: boolean): Promise<void> {
  const adapter = getNotificationAdapter();
  await repository.setEnabled(reminderId, enabled);

  if (enabled) {
    const reminder = await repository.getReminder(reminderId);
    // Only re-arm if the stored time is still ahead; a stale reminder would fire
    // immediately or not at all.
    if (reminder && isUpcoming(reminder.fireAt, now())) await deliver(reminder);
  } else {
    await adapter.cancel(reminderId);
  }
}

/** Removes every reminder for an entity, e.g. when its habit is deleted. */
export async function cancelForEntity(
  target: ReminderTarget,
  entityId: string,
): Promise<number> {
  const adapter = getNotificationAdapter();
  const existing = await repository.listForEntity(target, entityId);

  for (const reminder of existing) {
    await adapter.cancel(reminder.id);
  }

  return repository.deleteForEntity(target, entityId);
}

/** Turns all reminders off and clears the OS queue. */
export async function cancelAll(): Promise<void> {
  const adapter = getNotificationAdapter();
  await adapter.cancelAll();
}

/**
 * Re-arms every enabled reminder in the OS queue.
 *
 * Called on launch and after an app update. Android drops pending alarms on reboot and
 * both platforms drop them on update, so without this pass a user's reminders would
 * silently stop working and nothing would tell them.
 *
 * Individual failures are tolerated: the local row is still the truth, so a reminder that
 * could not be installed now will be retried on the next launch rather than lost.
 */
export async function rehydrate(): Promise<{ scheduled: number; total: number }> {
  const adapter = getNotificationAdapter();
  if (!adapter.available) return { scheduled: 0, total: 0 };

  const pending = await repository.listUpcoming(now());
  if (pending.length === 0) return { scheduled: 0, total: 0 };

  // Cancel first so rehydration is idempotent: calling this twice does not leave two
  // notifications for the same reminder.
  await adapter.cancelAll();

  const result = await adapter.rescheduleAll(
    pending.map((reminder) => ({
      identifier: reminder.id,
      title: reminder.title,
      body: reminder.body,
      fireAt: reminder.fireAt,
    })),
  );

  if (result.scheduled < result.total) {
    logger.warn(`Re-armed ${result.scheduled} of ${result.total} reminders`);
  }

  return { scheduled: result.scheduled, total: result.total };
}

/** Reminders the user has switched on, for the settings screen. */
export async function listEnabled(): Promise<ReminderWithText[]> {
  return repository.listEnabled();
}

export async function remindersFor(target: ReminderTarget, entityId: string) {
  return repository.listForEntity(target, entityId);
}

/** Preview of when a rule would fire, for the schedule editor. */
export function preview(
  spec: Omit<ReminderSpec, 'target' | 'entityId'> & { target?: ReminderTarget; entityId?: string },
  limit = 4,
): number[] {
  return upcomingFireTimes(
    {
      target: spec.target ?? 'custom',
      entityId: spec.entityId ?? 'preview',
      time: spec.time,
      cadence: spec.cadence,
      ...(spec.weekdays ? { weekdays: spec.weekdays } : {}),
      ...(spec.monthDay !== undefined ? { monthDay: spec.monthDay } : {}),
    },
    now(),
    limit,
  );
}

export { REMINDER_CADENCES, REMINDER_TARGETS };
export type { ReminderCadence, ReminderTarget };
