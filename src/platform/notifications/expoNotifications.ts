/**
 * Expo-backed notification adapter.
 *
 * This is the ONLY file that imports `expo-notifications`. Everything above it works
 * against {@link NotificationAdapter}, which is why no repository, service or screen
 * contains a `Platform.OS` branch for reminders.
 *
 * Platform differences handled here, not upstream:
 *
 * - **Permission.** iOS has `granted | denied | undetermined` plus `provisional` and
 *   `ephemeral`, which are granted for our purposes. Android 13+ has no permission at
 *   all below API 33 — asking is a no-op that reports granted.
 * - **Handlers.** Foreground behaviour differs: iOS by default shows nothing while the
 *   app is open, Android shows a banner. One handler is installed here so the behaviour
 *   is deliberate rather than accidental.
 * - **Scheduling.** `trigger` accepts a wall-clock date on both platforms, so no manual
 *   channel maths is needed. Cancelling is by our own identifier, which is why every
 *   reminder carries one.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  OK,
  unsupported,
  type Capability,
  type NotificationAdapter,
  type NotificationPermission,
  type RescheduleResult,
  type ScheduledNotification,
} from './types';

/**
 * Foreground presentation.
 *
 * Deliberately *not* a banner on iOS: a reminder arriving while the user is already
 * looking at the screen it refers to is noise. On Android the default banner is kept
 * because the platform convention is that a notification is expected to be visible.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: Platform.OS === 'android',
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Collapses the platform's richer status enums onto our three states.
 *
 * SDK 57 returns `PermissionStatus` ('granted' | 'denied' | 'undetermined'), which is
 * already almost exactly our vocabulary. iOS's finer `IosAuthorizationStatus` (provisional,
 * ephemeral, notDetermined) lives under the optional `ios` field and is only consulted when
 * the coarse status is ambiguous.
 */
function toPermission(
  status: string | undefined,
  granted: boolean,
): NotificationPermission {
  if (granted) return 'granted';
  switch (status) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'undetermined':
    default:
      return 'undetermined';
  }
}

class ExpoNotificationAdapter implements NotificationAdapter {
  readonly available = true;

  async getPermission(): Promise<NotificationPermission> {
    try {
      const current = await Notifications.getPermissionsAsync();
      // `granted` here means already authorised. Anything else still needs an ask.
      if (current.granted) return 'granted';
      if (current.canAskAgain === false && !current.granted) return 'denied';
      return 'undetermined';
    } catch {
      return 'undetermined';
    }
  }

  async requestPermission(): Promise<NotificationPermission> {
    try {
      const current = await Notifications.getPermissionsAsync();
      // Do not re-prompt for something the user already answered; iOS shows no dialog
      // and Android would count it as a second interruption.
      if (current.granted) return 'granted';
      if (current.canAskAgain === false) return 'denied';

      const asked = await Notifications.requestPermissionsAsync();
      return toPermission(asked.status, asked.granted);
    } catch {
      return 'denied';
    }
  }

  async schedule(input: {
    title: string;
    body: string;
    fireAt: number;
    identifier: string;
    sound?: boolean;
  }): Promise<Capability<ScheduledNotification>> {
    if (input.fireAt <= Date.now()) {
      return unsupported('That time has already passed.');
    }

    if ((await this.getPermission()) === 'denied') {
      return unsupported('Reminders are turned off for LifeOS in your device settings.');
    }

    try {
      const identifier = await Notifications.scheduleNotificationAsync({
        content: {
          title: input.title,
          body: input.body,
          ...(input.sound ? { sound: 'default' as const } : {}),
          data: { identifier: input.identifier },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(input.fireAt),
        },
      });

      return {
        supported: true,
        value: { id: identifier, fireAt: input.fireAt },
      };
    } catch (error) {
      // Never surfaced raw: an Expo message can contain bundle ids and platform detail
      // that is noise to a user, and this project's logging rule is no private content.
      return unsupported(
        error instanceof Error ? 'This reminder could not be scheduled.' : 'Scheduling failed.',
      );
    }
  }

  async cancel(identifier: string): Promise<Capability> {
    try {
      await Notifications.cancelScheduledNotificationAsync(identifier);
      return OK;
    } catch {
      // Cancelling something the OS already dropped is not a failure worth reporting.
      return OK;
    }
  }

  async cancelAll(): Promise<Capability> {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      return OK;
    } catch {
      return unsupported('Scheduled reminders could not be cleared.');
    }
  }

  async rescheduleAll(
    entries: readonly { identifier: string; title: string; body: string; fireAt: number }[],
  ): Promise<RescheduleResult> {
    let scheduled = 0;
    // One at a time and independently: a single failure must not abandon the rest of a
    // user's reminders, and the caller should learn how many actually took.
    for (const entry of entries) {
      const result = await this.schedule(entry);
      if (result.supported) scheduled += 1;
    }
    return { scheduled, total: entries.length };
  }
}

/**
 * Adapter used when the native module is unavailable.
 *
 * `expo-notifications` is absent in a web build, in Expo Go without a dev client, and in
 * a bare Node test process. Every method reports `supported: false` with a reason instead
 * of throwing, so shared code runs unchanged and the UI can say "not available here".
 */
export const unavailableNotificationAdapter: NotificationAdapter = {
  available: false,
  getPermission: async () => 'denied',
  requestPermission: async () => 'denied',
  schedule: async () => unsupported('Reminders need the LifeOS app on a phone or tablet.'),
  cancel: async () => OK,
  cancelAll: async () => OK,
  rescheduleAll: async () => ({ scheduled: 0, total: 0 }),
};

let adapter: NotificationAdapter | null = null;

/**
 * The shared adapter instance.
 *
 * Resolved lazily and memoised, and constructed defensively: importing the adapter must
 * never be able to fail the app's launch, so a module that throws on import degrades to
 * the unavailable adapter rather than propagating.
 */
export function getNotificationAdapter(): NotificationAdapter {
  if (adapter) return adapter;
  try {
    adapter = new ExpoNotificationAdapter();
  } catch {
    adapter = unavailableNotificationAdapter;
  }
  return adapter;
}

/** Test seam: install a fake adapter. Pass `null` to restore the real one. */
export function setNotificationAdapter(next: NotificationAdapter | null): void {
  adapter = next;
}
