/**
 * Biometric / device-authentication capability adapter.
 *
 * `PLATFORM_SUPPORT.md` requires Face ID / Touch ID on iOS and biometric authentication
 * on Android to be **optional enhancements** whose absence never breaks a feature. This
 * interface is how that promise is kept: like the notification adapter, it returns a
 * capability rather than throwing, so shared code can ask "can this device authenticate
 * the user?" and get an answer on both platforms.
 *
 * **Scope, stated plainly.** Migration 008 is explicit that the journal lock is "a UI gate
 * backed by SecureStore, not a claim of cryptographic at-rest encryption". This adapter
 * gates *access to the screen*. It does not encrypt journal rows, it does not protect the
 * database file, and nothing in this project should describe it as at-rest encryption.
 * A determined attacker with filesystem access and no device passcode can read the
 * database; this feature exists to stop someone casually reading over your shoulder or
 * picking up an unlocked phone.
 */

export type AuthMethod = 'fingerprint' | 'face' | 'iris' | 'passcode' | 'unknown';

export interface BiometricCapability {
  /** Whether the hardware and OS support device authentication at all. */
  available: boolean;
  /** Whether a credential is *enrolled* right now, which is the question that matters. */
  enrolled: boolean;
  /** The strongest method available, for a label like "Face ID" or "Fingerprint". */
  method: AuthMethod;
  /** Why authentication is unavailable, in words, or null when it is available. */
  reason: string | null;
  /**
   * True when only a device passcode would work — no biometric enrolled.
   *
   * Worth distinguishing, because "Face ID failed" and "no biometric is set up" call for
   * different user-facing words.
   */
  passcodeOnly: boolean;
}

/** Why an authentication attempt did not succeed. */
export type AuthFailure =
  | 'user_cancelled'
  | 'user_fallback'
  | 'lockout'
  | 'not_enrolled'
  | 'unavailable'
  | 'failed';

export type AuthResult =
  | { ok: true }
  | { ok: false; failure: AuthFailure; message: string };

export interface BiometricAdapter {
  readonly available: boolean;

  /** Current capability. Must not prompt. */
  capability(): Promise<BiometricCapability>;

  /**
   * Prompts for device authentication.
   *
   * `reason` is shown to the user by the OS, so it must be a sentence a person would want
   * to read — not a status string. Never pass anything derived from journal content.
   */
  authenticate(reason: string): Promise<AuthResult>;

  /** True when a passcode/PIN is set on the device, even with no biometric enrolled. */
  hasDeviceCredential(): Promise<boolean>;
}

/** Words for the hardware, for a settings label. */
export const AUTH_METHOD_LABELS: Record<AuthMethod, string> = {
  fingerprint: 'Fingerprint',
  face: 'Face ID',
  iris: 'Iris',
  passcode: 'Device passcode',
  unknown: 'Device authentication',
};

/** Words for a failure, written for a person rather than a log. */
export const AUTH_FAILURE_MESSAGES: Record<AuthFailure, string> = {
  user_cancelled: 'Unlock cancelled.',
  user_fallback: 'Unlock cancelled.',
  lockout: 'Too many attempts. Use your device passcode to try again.',
  not_enrolled: 'No fingerprint or face is set up on this device.',
  unavailable: 'Device authentication is not available here.',
  failed: 'That did not match. Try again.',
};
