# ROADMAP

Status legend: `DONE` (verified), `PARTIAL` (code exists, not device-verified),
`TODO` (not started). The authoritative detail is in `DEVELOPMENT/PROJECT_STATUS.md`,
and requirement-by-requirement detail is in `DEVELOPMENT/SPEC_TRACEABILITY.md`.

**Every `DONE` below means a command passed in this environment. Nothing in this project
has been run on a device.**

## Phase 1 — Foundation ✅ PARTIAL

- Expo SDK 57 + React Native 0.86 + TypeScript strict ✅
- Expo Router navigation and entry gate ✅
- Centralised design system with light/dark/system ✅
- SQLite schema, migrations and driver ✅
- Onboarding and Today dashboard ✅
- Verification: typecheck, lint, **1017 tests across 36 suites** ✅
- Outstanding: on-device iOS/Android verification

## Phase 2 — Habits and goals ✅ DONE

- Habits: CRUD, archive, restore, complete, undo, history, streaks ✅
- Goals, milestones, tasks: lifecycle state machine, derived progress ✅
- Today's and overdue tasks surfaced on the Today dashboard ✅
- Verification: 68 tests across habits, goals and state transitions ✅
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

## Phase 4 — Productivity, focus, reminders ✅ DONE

- Focus sessions carry a wall-clock deadline, so a timer survives app termination ✅
- Presets, custom lengths, completion, abandonment, interruption recovery on launch ✅
- Daily/weekly/monthly/yearly reviews ✅
- Local reminders behind `src/platform/notifications/`, permission requested only on a
  deliberate tap ✅
- `rehydrate()` on launch, because Android drops pending alarms on reboot and both
  platforms drop them on update ✅
- Recurrence cadence rules (migration 014) with reminder text (migration 015) ✅
- Verification: 31 integration + 28 unit focus tests, 43 notification tests,
  56 recurrence tests ✅
- Outstanding: on-device iOS/Android verification; a UI for creating a recurring
  transaction

## Phase 5 — Book library and reader ⚠️ PARTIAL

- Document-picker import with validation, `.part` then atomic rename, orphan sweep ✅
- Library: sections, metadata, statuses, search, sort, filters, collections ✅
- Reader screen with table of contents, bookmarks, highlights, notes and progress ✅
- Reading sessions as the source of truth; all totals derived on read (ADR-0020) ✅
- **Page rendering, text search, zoom, page modes and sepia/black themes are not
  implemented.** `StructurePdfEngine` reports `rendering: false` and `textSearch: false`
  honestly rather than faking them (ADR-0006) ✅ as a design choice
- Verification: 34 PDF + 31 books + 23 booksService + 8 UI tests ✅
- **Next:** selecting a rasterising engine would unblock all five gaps at once

## Phase 6 — Health ⚠️ PARTIAL

- Sleep, hydration, nutrition: quick-adds, ml/L/oz parsing, manual food DB, meals,
  snapshots, sleep logging with averages ✅
- Recovery: daily 1-10 ratings and six mobility kinds, 14-day report derived on read ✅
- **No medical or interpretive claims anywhere**, enforced by a test ✅
- HealthKit and Health Connect adapters intentionally deferred: they are optional
  enhancements and must never gate a core feature ⬜ by design
- Verification: 38 unit + 36 health + 34 recovery tests ✅
- Outstanding: on-device iOS/Android verification

## Phase 7 — Journal, finance, analytics ✅ DONE

- Journal: entries, tags, favourites, attachments, local FTS5-or-`LIKE` search ✅
- Journal export to Markdown, JSON and CSV, bodies omitted by default, atomic writes ✅
- Journal lock behind a device-authentication adapter, re-locked on blur, never persisted
  (ADR-0021) ✅
- Finance: accounts, categories, transactions, atomic transfers, budgets with set and
  remove ✅
- Multi-currency: user-entered rates stored as micro-scaled integers, exponent-aware
  conversion, and a combined balance that names what it could not convert (ADR-0019) ✅
- Analytics: day/week/month/year periods, all derived on read, copy that describes and
  never judges (ADR-0020) ✅
- Verification: 33 journal + 39 export + 20 money + 33 finance + 33 rates + 20 rates
  integration + 44 analytics tests ✅
- Outstanding: on-device iOS/Android verification

## Phase 8 — Achievements, calendar, backup ✅ DONE

- Achievements evaluated on write and on launch; unlock dates and personal records ✅
- Gamification can be switched off without hiding progress ✅
- Calendar as a projection over every domain table; nothing written back ✅
- Backup: validated documents, deterministic export, inspect-then-confirm restore,
  transactional replace, safety copy, and an undo that is itself undoable ✅
- Verification: 38 achievements + 25 calendar + 42 backup tests ✅
- Outstanding: sharing a backup off the device is not implemented; on-device verification

## Phase 9 — Settings ✅ DONE

- Hub plus six screens: appearance, units and targets, currency and rates, reminders,
  privacy, data ✅
- Every implemented destination reachable from Today and from Settings; nothing appears
  in navigation until it exists (ADR-0010) ✅
- Outstanding: on-device iOS/Android verification

## Phase 10 — Hardening and release ⬜ BLOCKED

- Automated accessibility contract tests exist and cover every new screen.
- **Selecting a rasterising PDF engine** — the single highest-value remaining dependency
  decision; it unblocks five reader gaps.
- **A UI for recurring transactions** — schema and cadence rules exist.
- Full VoiceOver/TalkBack and device performance passes require hardware.
- Full security audit and performance audit not started.
- Release phases are blocked on a macOS host for iOS (ISSUE-002) and on an Android
  emulator being provisioned.
