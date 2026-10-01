/**
 * `expo-local-authentication` implementation of {@link BiometricAdapter}.
 *
 * This is the only file that imports `expo-local-authentication`. Everything above it
 * works against the interface, which is why the journal lock code contains no
 * `Platform.OS` branch and behaves identically on iOS and Android.
 *
 * The module reports Face ID on iOS and fingerprint/iris on Android, but it does **not**
 * distinguish them in a way we should depend on: on iOS `authenticationType` can be
 * `'face'` while the device actually has Touch ID, and on Android the same value covers
 * several manufacturers. So the adapter reports what the module says and labels it
 * defensively, rather than pretending to know the hardware.
 *
 * `hasHardwareAsync()` false is treated as *unavailable*, and
 * `isEnrolledAsync()` false as *enrolled-nothing* — two different words for a user, since
 * "this phone cannot do it" and "you have not set it up" lead to different actions.
 */

import * as LocalAuthentication from 'expo-local-authentication';

import {
  AUTH_FAILURE_MESSAGES,
  type AuthFailure,
  type AuthMethod,
  type AuthResult,
  type BiometricAdapter,
  type BiometricCapability,
} from './types';

/**
 * Maps the module's supported authentication types onto our hardware vocabulary.
 *
 * The API returns an *array*, and its order is not a strength ranking we should trust, so
 * a fixed precedence is applied instead: face, then iris, then fingerprint. Precedence
 * only affects the label shown in Settings.
 */
function toMethod(types: readonly LocalAuthentication.AuthenticationType[]): AuthMethod {
  const set = new Set<number>(types as number[]);
  if (set.has(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'face';
  if (set.has(LocalAuthentication.AuthenticationType.IRIS)) return 'iris';
  if (set.has(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'fingerprint';
  return 'unknown';
}

class ExpoBiometricAdapter implements BiometricAdapter {
  get available(): boolean {
    return true;
  }

  async capability(): Promise<BiometricCapability> {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      if (!hasHardware) {
        return {
          available: false,
          enrolled: false,
          method: 'unknown',
          reason: 'This device has no fingerprint or face unlock.',
          passcodeOnly: false,
        };
      }

      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!enrolled) {
        // Hardware exists but nothing is set up. A device passcode may still work, so this
        // is reported as "passcode only" rather than "unavailable".
        return {
          available: true,
          enrolled: false,
          method: 'passcode',
          reason: 'Set up a fingerprint or face unlock on this device to lock LifeOS.',
          passcodeOnly: true,
        };
      }

      return {
        available: true,
        enrolled: true,
        method: toMethod(await LocalAuthentication.supportedAuthenticationTypesAsync()),
        reason: null,
        passcodeOnly: false,
      };
    } catch {
      return {
        available: false,
        enrolled: false,
        method: 'unknown',
        reason: 'Device authentication is not available here.',
        passcodeOnly: false,
      };
    }
  }

  async authenticate(reason: string): Promise<AuthResult> {
    try {
      const capability = await this.capability();
      if (!capability.available) {
        return { ok: false, failure: 'unavailable', message: capability.reason ?? 'Not available.' };
      }
      if (!capability.enrolled) {
        return { ok: false, failure: 'not_enrolled', message: capability.reason ?? 'Not set up.' };
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: reason,
        // Leave the OS cancel button in place. Hiding it strands users who cannot use
        // biometrics, and the app has no credential of its own to fall back to.
        disableDeviceFallback: false,
        // No `cancelTitle` override: the default word is localised by the platform, and a
        // hard-coded English string here would not be.
      });

      if (result.success) return { ok: true };
      return { ok: false, failure: toFailure(result.error), message: messageFor(result.error) };
    } catch {
      return {
        ok: false,
        failure: 'unavailable',
        message: AUTH_FAILURE_MESSAGES.unavailable,
      };
    }
  }

  async hasDeviceCredential(): Promise<boolean> {
    try {
      return await LocalAuthentication.hasHardwareAsync();
    } catch {
      return false;
    }
  }
}

/**
 * The module's error strings are the only signal available, so they are mapped by
 * content. Unrecognised text becomes 'failed' rather than being forced into a specific
 * cause, which would show the user a wrong explanation.
 */
function toFailure(error: string | undefined): AuthFailure {
  const text = (error ?? '').toLowerCase();
  if (text.includes('cancel') || text.includes('app_cancel') || text.includes('system_cancel')) {
    return 'user_cancelled';
  }
  if (text.includes('fallback')) return 'user_fallback';
  if (text.includes('lockout') || text.includes('biometrylockout')) return 'lockout';
  if (text.includes('not_enrolled') || text.includes('passcode not set')) return 'not_enrolled';
  if (text.includes('unavailable') || text.includes('not_supported')) return 'unavailable';
  return 'failed';
}

function messageFor(error: string | undefined): string {
  return AUTH_FAILURE_MESSAGES[toFailure(error)];
}

/**
 * Adapter used where device authentication does not exist — web, Expo Go without a dev
 * client, and a bare Node test process.
 *
 * Reports unavailable with a reason rather than throwing, so shared code runs unchanged.
 */
export const unavailableBiometricAdapter: BiometricAdapter = {
  available: false,
  capability: async () => ({
    available: false,
    enrolled: false,
    method: 'unknown' as AuthMethod,
    reason: 'Device authentication is only available in the LifeOS app on a phone or tablet.',
    passcodeOnly: false,
  }),
  authenticate: async () => ({
    ok: false,
    failure: 'unavailable' as AuthFailure,
    message: AUTH_FAILURE_MESSAGES.unavailable,
  }),
  hasDeviceCredential: async () => false,
};

let adapter: BiometricAdapter | null = null;

export function getBiometricAdapter(): BiometricAdapter {
  if (adapter) return adapter;
  try {
    adapter = new ExpoBiometricAdapter();
  } catch {
    adapter = unavailableBiometricAdapter;
  }
  return adapter;
}

/** Test seam: install a fake adapter. Pass `null` to restore the real one. */
export function setBiometricAdapter(next: BiometricAdapter | null): void {
  adapter = next;
}
