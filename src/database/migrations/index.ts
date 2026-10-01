import type { Migration } from './types';
import { migration001 } from './001_core';
import { migration002 } from './002_habits';
import { migration003 } from './003_goals';
import { migration004 } from './004_fitness';
import { migration005 } from './005_books';
import { migration006 } from './006_productivity';
import { migration007 } from './007_health';
import { migration008 } from './008_journal';
import { migration009 } from './009_finance';
import { migration010 } from './010_achievements';
import { migration011 } from './011_sync';
import { migration012 } from './012_search';
import { migration013 } from './013_recovery';
import { migration014 } from './014_recurrence';
import { migration015 } from './015_reminder_text';

export type { Migration } from './types';

/**
 * The ordered migration list. Order in this array is the only thing that determines
 * execution order; versions must match array positions (asserted by tests).
 */
export const MIGRATIONS: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
  migration011,
  migration012,
  migration013,
  migration014,
  migration015,
];
