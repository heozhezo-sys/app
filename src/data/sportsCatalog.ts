/**
 * Seeded sports catalogue.
 *
 * The specification lists the sports that must be available "at minimum"; all of them
 * appear here. Every entry carries its own metric schema, which is what makes sport
 * metrics *configurable*: a session records whatever its sport declares, and a custom
 * sport can declare something different.
 *
 * Metric keys are stable and namespaced (`distance_m`, not `distance`) so a future
 * unit change is a deliberate migration rather than an accidental reinterpretation of
 * old data.
 */

export type SportCategory =
  | 'team_ball'
  | 'racket'
  | 'combat'
  | 'water'
  | 'outdoor'
  | 'winter'
  | 'athletics'
  | 'precision';

export type MetricUnit = 'm' | 's' | 'count' | 'points' | 'm_elevation';

export interface SportMetric {
  /** Stable key used in stored sessions. */
  key: string;
  /** Human label shown in the UI. */
  label: string;
  unit: MetricUnit;
}

export interface CatalogSport {
  id: string;
  name: string;
  category: SportCategory;
  metrics: readonly SportMetric[];
}

const DISTANCE: SportMetric = { key: 'distance_m', label: 'Distance', unit: 'm' };
const DURATION: SportMetric = { key: 'duration_s', label: 'Duration', unit: 's' };
const PACE: SportMetric = { key: 'avg_speed_mps', label: 'Average speed', unit: 'm' };
const ELEVATION: SportMetric = { key: 'elevation_m', label: 'Elevation', unit: 'm_elevation' };
const ROUNDS: SportMetric = { key: 'rounds', label: 'Rounds', unit: 'count' };
const POINTS: SportMetric = { key: 'points', label: 'Points', unit: 'points' };
const WORK_TIME: SportMetric = { key: 'work_time_s', label: 'Work time', unit: 's' };
const REPS: SportMetric = { key: 'reps', label: 'Reps', unit: 'count' };

/**
 * Built-in sports. `is_custom` is always 0 for these; a user-created sport is a
 * separate row and never appears in this list.
 */
export const SPORTS_CATALOG: readonly CatalogSport[] = [
  // Team ball
  { id: 'sp-basketball', name: 'Basketball', category: 'team_ball', metrics: [DURATION] },
  { id: 'sp-football', name: 'Football', category: 'team_ball', metrics: [DURATION] },
  { id: 'sp-soccer', name: 'Soccer', category: 'team_ball', metrics: [DURATION] },
  { id: 'sp-volleyball', name: 'Volleyball', category: 'team_ball', metrics: [DURATION, POINTS] },
  { id: 'sp-baseball', name: 'Baseball', category: 'team_ball', metrics: [DURATION] },
  { id: 'sp-softball', name: 'Softball', category: 'team_ball', metrics: [DURATION] },
  { id: 'sp-rugby', name: 'Rugby', category: 'team_ball', metrics: [DURATION] },
  { id: 'sp-cricket', name: 'Cricket', category: 'team_ball', metrics: [DURATION, POINTS] },
  { id: 'sp-handball', name: 'Handball', category: 'team_ball', metrics: [DURATION] },
  { id: 'sp-futsal', name: 'Futsal', category: 'team_ball', metrics: [DURATION] },
  { id: 'sp-hockey', name: 'Hockey', category: 'team_ball', metrics: [DURATION] },
  { id: 'sp-water-polo', name: 'Water Polo', category: 'team_ball', metrics: [DURATION] },

  // Racket
  { id: 'sp-tennis', name: 'Tennis', category: 'racket', metrics: [DURATION, POINTS] },
  { id: 'sp-table-tennis', name: 'Table Tennis', category: 'racket', metrics: [DURATION, POINTS] },
  { id: 'sp-badminton', name: 'Badminton', category: 'racket', metrics: [DURATION, POINTS] },
  { id: 'sp-squash', name: 'Squash', category: 'racket', metrics: [DURATION, POINTS] },
  { id: 'sp-pickleball', name: 'Pickleball', category: 'racket', metrics: [DURATION, POINTS] },

  // Combat
  { id: 'sp-boxing', name: 'Boxing', category: 'combat', metrics: [ROUNDS, WORK_TIME] },
  { id: 'sp-kickboxing', name: 'Kickboxing', category: 'combat', metrics: [ROUNDS, WORK_TIME] },
  { id: 'sp-muay-thai', name: 'Muay Thai', category: 'combat', metrics: [ROUNDS, WORK_TIME] },
  { id: 'sp-mma', name: 'MMA', category: 'combat', metrics: [ROUNDS, WORK_TIME] },
  { id: 'sp-bjj', name: 'Brazilian Jiu-Jitsu', category: 'combat', metrics: [DURATION, REPS] },
  { id: 'sp-judo', name: 'Judo', category: 'combat', metrics: [DURATION, REPS] },
  { id: 'sp-karate', name: 'Karate', category: 'combat', metrics: [DURATION, REPS] },
  { id: 'sp-taekwondo', name: 'Taekwondo', category: 'combat', metrics: [DURATION, REPS] },
  { id: 'sp-wrestling', name: 'Wrestling', category: 'combat', metrics: [DURATION, REPS] },

/* __PART2__ */
// Water
  { id: 'sp-swimming', name: 'Swimming', category: 'water', metrics: [DISTANCE, DURATION, PACE] },
  { id: 'sp-diving', name: 'Diving', category: 'water', metrics: [DURATION] },
  { id: 'sp-surfing', name: 'Surfing', category: 'water', metrics: [DURATION] },
  { id: 'sp-paddleboarding', name: 'Paddleboarding', category: 'water', metrics: [DISTANCE, DURATION] },
  { id: 'sp-kayaking', name: 'Kayaking', category: 'water', metrics: [DISTANCE, DURATION] },
  { id: 'sp-canoeing', name: 'Canoeing', category: 'water', metrics: [DISTANCE, DURATION] },
  { id: 'sp-rowing', name: 'Rowing', category: 'water', metrics: [DISTANCE, DURATION, PACE] },

  // Outdoor
  { id: 'sp-hiking', name: 'Hiking', category: 'outdoor', metrics: [DISTANCE, DURATION, ELEVATION] },
  { id: 'sp-trail-running', name: 'Trail Running', category: 'outdoor', metrics: [DISTANCE, DURATION, ELEVATION] },
  { id: 'sp-rock-climbing', name: 'Rock Climbing', category: 'outdoor', metrics: [DURATION, WORK_TIME] },
  { id: 'sp-skateboarding', name: 'Skateboarding', category: 'outdoor', metrics: [DURATION] },
  { id: 'sp-rollerblading', name: 'Rollerblading', category: 'outdoor', metrics: [DISTANCE, DURATION] },

  // Winter
  { id: 'sp-skiing', name: 'Skiing', category: 'winter', metrics: [DISTANCE, DURATION, ELEVATION] },
  { id: 'sp-snowboarding', name: 'Snowboarding', category: 'winter', metrics: [DISTANCE, DURATION, ELEVATION] },

  // Athletics
  { id: 'sp-gymnastics', name: 'Gymnastics', category: 'athletics', metrics: [DURATION, WORK_TIME] },
  { id: 'sp-athletics', name: 'Athletics', category: 'athletics', metrics: [DISTANCE, DURATION] },
  { id: 'sp-fencing', name: 'Fencing', category: 'athletics', metrics: [DURATION, POINTS] },

  // Precision
  { id: 'sp-golf', name: 'Golf', category: 'precision', metrics: [DURATION, POINTS] },
  { id: 'sp-archery', name: 'Archery', category: 'precision', metrics: [ROUNDS, POINTS] },
  { id: 'sp-bowling', name: 'Bowling', category: 'precision', metrics: [ROUNDS, POINTS] },
  { id: 'sp-darts', name: 'Darts', category: 'precision', metrics: [ROUNDS, POINTS] },
];

export function findCatalogSport(id: string): CatalogSport | undefined {
  return SPORTS_CATALOG.find((s) => s.id === id);
}

/** Sports that record a distance, used to pick a sensible default for a custom sport. */
export const DISTANCE_SPORTS: ReadonlySet<string> = new Set(
  SPORTS_CATALOG.filter((s) => s.metrics.some((m) => m.key === 'distance_m')).map((s) => s.id),
);
