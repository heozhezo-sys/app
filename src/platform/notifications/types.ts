/**
 * Notification capability adapter.
 *
 * PLATFORM_SUPPORT.md: "If a native capability is unavailable on one platform, provide a
 * graceful fallback rather than breaking the feature." And AGENT_KNOWLEDGE_PROTOCOL:
 * "Identify both platform implementations and a fallback when the capability is
 * unavailable."
 *
 * So this interface never throws for a missing capability. Every method returns a
 * {@link Capability}: `{ supported: false, reason }` when the OS, the user permission or
 * the device prevents it. Shared business logic can then ask "can I notify?" and get an
 * answer instead of an exception it would have to catch and interpret.
 *
 * Nothing outside `src/platform/notifications/` may import `expo-notifications` directly.
 * That is what keeps repositories and services platform-neutral.
 */

/** Result of asking the platform to do something. */
export type Capability<T = void> =
  | { supported: true; value: T }
  | { supported: false; reason: string };

/**
 * Permission states, collapsed across platforms.
 *
 * Android has a third state (`SCHEDULE_EXACT_ALARM`) with no iOS equivalent, and iOS
 * distinguishes "provisional" and "ephemeral". Both are folded into `granted` or
 * `denied` here, because every caller in this app only needs to know whether it may
 * schedule, and a platform-specific enum leaking into the service layer would force
 * `Platform.OS` branches back into shared code.
 */
export type NotificationPermission =
  | 'granted'
  | 'denied'
  /** Not yet asked. Treated as "may ask", not as "may notify". */
  | 'undetermined';

export interface ScheduledNotification {
  /** Identifier the adapter assigned, or the one we supplied, for later cancellation. */
  id: string;
  /** Epoch ms the notification is set to fire. */
  fireAt: number;
}

export interface NotificationAdapter {
  /** Whether local notifications exist on this platform at all. */
  readonly available: boolean;

  /**
   * Current permission without prompting.
   *
   * Must never prompt on its own — asking for a permission is a user-visible moment and
   * belongs at a point where the user has just done something that implies they want it.
   */
  getPermission(): Promise<NotificationPermission>;

  /**
   * Asks the OS for permission.
   *
   * Call this only in response to a deliberate action. On Android 13+ this opens the
   * system prompt; on iOS 12+ it is a one-time grant that the user can still revoke in
   * Settings. Either way the answer is reported honestly rather than assumed.
   */
  requestPermission(): Promise<NotificationPermission>;

  /**
   * Schedules a local notification for an absolute time.
   *
   * Returns `supported: false` rather than throwing if the time is in the past, if
   * permission is missing, or if the platform refuses. A reminder that could not be set
   * up is a degraded feature, not a crash.
   */
  schedule(input: {
    title: string;
    body: string;
    fireAt: number;
    /** Stable id used to cancel or replace this reminder later. */
    identifier: string;
    /** iOS sound; ignored where unsupported. */
    sound?: boolean;
  }): Promise<Capability<ScheduledNotification>>;

  /** Cancels one scheduled notification. Missing or already-fired is not an error. */
  cancel(identifier: string): Promise<Capability>;

  /** Cancels everything this app scheduled. Used by "turn all reminders off". */
  cancelAll(): Promise<Capability>;

  /**
   * Re-schedules everything after a reboot or an app update.
   *
   * Android clears pending alarms on reboot and both platforms clear them on update, so
   * the local `reminders` table is the source of truth and the OS copy is a cache.
   *
   * Returns a partial-success count rather than a {@link Capability}, because "9 of 10
   * reminders re-armed" is a genuinely different outcome from "did it work" — and the
   * caller needs the count to tell the user their reminders may not all fire.
   */
  rescheduleAll(
    entries: readonly { identifier: string; title: string; body: string; fireAt: number }[],
  ): Promise<RescheduleResult>;
}

/** How many reminders were successfully re-established, out of how many were asked for. */
export interface RescheduleResult {
  scheduled: number;
  total: number;
}

/** Result for a capability that returns nothing. */
export const OK: Capability = { supported: true, value: undefined };

export function unsupported(reason: string): Capability<never> {
  return { supported: false, reason };
}

/** Human-readable explanation for the settings screen, or null when it is permitted. */
export function describePermission(state: NotificationPermission): string | null {
  switch (state) {
    case 'granted':
      return null;
    case 'denied':
      return 'Reminders are turned off for LifeOS in your device settings.';
    case 'undetermined':
      return null;
    default:
      return null;
  }
}
