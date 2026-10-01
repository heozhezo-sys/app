/**
 * Calendar feature hooks.
 *
 * The calendar is a *projection*: every read is a `SELECT` over the domain tables and
 * nothing is ever written back. That is why there is no mutation hook in this file, and
 * why the channel is `today` — the calendar has no tables of its own to announce.
 */

import { CHANNELS } from '@/database/database';
import { useAsyncResource } from '@/hooks/useAsyncResource';
import * as service from '@/services/calendarService';
import type { DateKey } from '@/utils/dates';

/** Entries across an inclusive range, grouped by day. */
export function useCalendarRange(from: DateKey, to: DateKey) {
  return useAsyncResource(() => service.timeline(from, to), CHANNELS.today, {
    deps: [from, to],
  });
}

/** One day, ordered within the day. */
export function useCalendarDay(date: DateKey) {
  return useAsyncResource(() => service.day(date), CHANNELS.today, { deps: [date] });
}

/** A forward-looking week, for the "coming up" strip. */
export function useCalendarUpcoming(from: DateKey, days = 7) {
  return useAsyncResource(() => service.upcoming(from, days), CHANNELS.today, {
    deps: [from, days],
  });
}

export {
  CALENDAR_KIND_LABELS,
  CALENDAR_KINDS,
  MAX_RANGE_DAYS,
  countsByKind,
  dayHeading,
  routeFor,
} from '@/services/calendarService';
export type { CalendarEntry, CalendarKind, TimelineResult } from '@/services/calendarService';