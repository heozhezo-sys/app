/**
 * Weekday list serialisation for the recurrence tables.
 *
 * `task_recurrence.weekdays` and `recurring_transactions.weekdays` store a set of days as
 * compact JSON text, e.g. `"[1,3,5]"` for Monday, Wednesday, Friday.
 *
 * A join table would be more relational, but the value is at most seven small integers
 * that are only ever read and written whole. A join table would mean three extra queries
 * per rule for no benefit, and would make "edit this rule" a multi-row operation.
 *
 * Parsing is **total**: anything unparseable yields `[]` rather than throwing, because a
 * corrupt column must not be able to stop the app from opening. An empty list means
 * "no days named", which the recurrence rules already treat as a well-defined case.
 */

/** Serialises a weekday set. Returns null for an absent or empty set. */
export function serialiseWeekdays(days: readonly number[] | undefined | null): string | null {
  if (!days || days.length === 0) return null;

  const clean = days
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .filter((day, index, all) => all.indexOf(day) === index)
    .sort((a, b) => a - b);

  if (clean.length === 0) return null;
  return JSON.stringify(clean);
}

/**
 * Parses a stored weekday set.
 *
 * Falls back to a comma-separated plain string (e.g. `"1,3,5"`) so a value written by an
 * earlier hand-rolled implementation still reads correctly rather than silently becoming
 * "no days".
 */
export function parseWeekdays(raw: string | null | undefined): number[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((day): day is number => typeof day === 'number' && Number.isInteger(day))
        .filter((day) => day >= 0 && day <= 6)
        .filter((day, index, all) => all.indexOf(day) === index)
        .sort((a, b) => a - b);
    }
  } catch {
    // Not JSON. Fall through to the plain-string form below.
  }

  return raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .filter((day, index, all) => all.indexOf(day) === index)
    .sort((a, b) => a - b);
}
