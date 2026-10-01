import type { FieldErrors } from '@/utils/validation';

/**
 * Business-rule failure with field-level detail for the UI.
 *
 * This lives in its own module rather than inside a feature service so that features
 * stay independent: `goalsService` must not have to import from `habitsService` just
 * to report a bad title.
 */
export class ValidationError extends Error {
  constructor(
    readonly fields: FieldErrors,
    message = 'Please check the highlighted fields',
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** True when `error` is a field-level validation failure. */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}
