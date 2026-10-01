# ROADMAP

Status legend: `DONE` (verified), `PARTIAL` (code exists, not device-verified),
`TODO` (not started). The authoritative detail is in `DEVELOPMENT/PROJECT_STATUS.md`.

## Phase 1 — Foundation ✅ PARTIAL

- Expo SDK 57 + React Native 0.86 + TypeScript strict ✅
- Expo Router navigation and entry gate ✅
- Centralised design system with light/dark/system ✅
- SQLite schema, migrations and driver ✅
- Onboarding and Today dashboard ✅
- Verification: typecheck, lint, 222 tests ✅
- Outstanding: on-device iOS/Android verification

## Phase 2 — Habits and goals ✅ DONE

- Habits: CRUD, archive, restore, complete, undo, history, streaks ✅
- Goals, milestones, tasks: lifecycle state machine, derived progress ✅
- Today's and overdue tasks surfaced on the Today dashboard ✅
- Verification: 49 goals tests + 19 state-machine tests ✅
- Outstanding: on-device iOS/Android verification

## Phase 3 — Fitness and sports ✅ DONE

- One activity architecture: gym, home, mobility, stretching, cross-training ✅
- Exercises, sets, reps, weight (integer grams), duration, RPE, rest-by-set ✅
- Bodyweight as a real zero; fractional plate weights exact ✅
- Interrupted workouts resumable after a restart ✅
- Body metrics, derived personal records ✅
- 43 seeded exercises, 47 seeded sports, custom sports ✅
- Configurable per-sport metric schemas ✅
- Verification: 57 tests ✅
- Outstanding: on-device iOS/Android verification

## Phase 4 — Productivity, focus, calendar, notifications ⬜ TODO

Focus-session schema encodes a wall-clock deadline so timers survive termination.
No feature code yet.

## Phase 5 — Local book library and reader ⬜ TODO

Books/reading schema exists. `PDFReaderEngine` abstraction not yet written.

## Phase 6 — Sleep, hydration, nutrition, health integrations ⬜ TODO

Health schema exists. HealthKit / Health Connect adapters intentionally deferred:
they are optional enhancements and must never gate a core feature.

## Phase 7 — Journal, finance, analytics ⬜ TODO

Schemas exist. No feature code.

## Phase 8 — Backup, restore, optional sync ⬜ TODO

`sync_queue` outbox schema exists so sync can be added without a destructive change.
No transport implemented, deliberately: there is no remote service.

## Phase 9 — Hardening, accessibility, performance, release ⬜ BLOCKED

- Automated accessibility contract tests exist (15 tests).
- Full VoiceOver/TalkBack and device performance passes require hardware.
- Release phases are blocked on a macOS host for iOS (see `PROJECT_AUDIT.md` §2).

