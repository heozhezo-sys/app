/**
 * Input validation.
 *
 * Validation lives here rather than in screens so that the same rule is enforced by
 * the UI, by a service call, and by a background import. A validation function
 * returns a map of field -> message; an empty map means valid.
 */

export type FieldErrors<TField extends string = string> = Partial<Record<TField, string>>;

export const TITLE_MAX = 120;
export const NOTE_MAX = 10_000;

export interface TitleValidationOptions {
  max?: number;
  required?: boolean;
  /** Extra check, e.g. "already used by another habit". */
  taken?: (value: string) => boolean;
}

export function validateTitle(
  value: string,
  options: TitleValidationOptions = {},
): string | undefined {
  const max = options.max ?? TITLE_MAX;
  const trimmed = value.trim();

  if (options.required !== false && trimmed.length === 0) return 'Required';
  if (trimmed.length > max) return `Keep it under ${max} characters`;
  if (options.taken?.(trimmed)) return 'Already exists';
  return undefined;
}

export function validateNote(value: string, max = NOTE_MAX): string | undefined {
  if (value.length > max) return `Keep it under ${max.toLocaleString()} characters`;
  return undefined;
}

/** Accepts `HH:MM` on a 24-hour clock. */
export function validateTime(value: string): string | undefined {
  if (!/^\d{2}:\d{2}$/.test(value)) return 'Use HH:MM';
  const [h, m] = value.split(':').map(Number);
  if (h === undefined || m === undefined) return 'Use HH:MM';
  if (h > 23 || m > 59) return 'Not a real time';
  return undefined;
}

/** Accepts a positive integer, optionally bounded. */
export function validatePositiveInt(
  value: number,
  options: { min?: number; max?: number } = {},
): string | undefined {
  if (!Number.isFinite(value) || !Number.isInteger(value)) return 'Whole number';
  if (options.min !== undefined && value < options.min) return `At least ${options.min}`;
  if (options.max !== undefined && value > options.max) return `At most ${options.max}`;
  return undefined;
}

export function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/** Removes control characters that have no business in stored text. */
export function sanitiseText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}
