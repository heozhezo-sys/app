# PROJECT STATUS — HONEST COMPLETION LEDGER

This file exists to prevent the single worst outcome for this project: a partially
built application described as finished.

Rules for this file:
- A phase is **VERIFIED** only if a command was run and passed.
- **IMPLEMENTED** means the code exists and is wired up, but has not been exercised on
  a real device.
- **NOT IMPLEMENTED** means there is no code. These are not stubs or placeholders.
- No item is marked VERIFIED on the basis of having been written.

Last updated: 2026-10-01. Build host: **Linux**, Node 22, npm.

---

## Verified (command run, passed)

| Area | Evidence |
|---|---|
| Strict TypeScript compilation of the whole project | `npm run typecheck` exit 0 |
| Lint across the whole project | `npm run lint`, zero warnings |
| Migration engine against real SQLite | 16 tests, `tests/integration/migrations.test.ts` |
| Schema integrity guarantees | 16 tests, `tests/integration/schema.test.ts` |
| Habit vertical slice (DB + repository + service + logic) | 19 tests, `tests/integration/habits.test.ts` |
| Goals / milestones / tasks slice, incl. state machine | 49 tests across `tests/integration/goals.test.ts` and `tests/unit/stateTransitions.test.ts` |
| Fitness slice: sets, workouts, body metrics, sports | 57 tests across `tests/integration/fitness.test.ts` and `tests/unit/units.test.ts` |
| Money arithmetic correctness | 20 tests, `tests/unit/money.test.ts` |
| Local-calendar date correctness | 16 tests, `tests/unit/dates.test.ts` |
| Design-system accessibility contract | 33 tests, `tests/ui/components.test.tsx` |
| PDF parser, engine and import pipeline | 34 tests, `tests/integration/pdf.test.ts` |
| Books, reading history, bookmarks, highlights, notes | 31 tests, `tests/integration/books.test.ts` |
| `ExpoStorageAdapter` against a fake `expo-file-system` | 30 tests, `tests/unit/expoStorage.test.ts` |
| Books use-case layer, end to end | 23 tests, `tests/integration/booksService.test.ts` |
| Book row accessibility contract | 8 tests, `tests/ui/books.test.tsx` |
| Focus timer arithmetic and presets | 28 tests, `tests/unit/focus.test.ts` |
| Focus sessions, recovery and reviews | 31 tests, `tests/integration/focus.test.ts` |
| Focus countdown accessibility | 5 tests, `tests/ui/focus.test.tsx` |
| Health domain logic: units, sleep windows, nutrition | 38 tests, `tests/unit/health.test.ts` |
| Hydration, nutrition and sleep end to end | 36 tests, `tests/integration/health.test.ts` |
| Recovery ratings and mobility sessions | 34 tests, `tests/integration/recovery.test.ts` |
| Journal tags and search-query construction | 20 tests, `tests/unit/journal.test.ts` |
| Journal end to end, including the privacy assertion | 33 tests, `tests/integration/journal.test.ts` |
| Journal export: rendering, atomic writes, biometric lock | 39 tests, `tests/integration/journalExport.test.ts` |
| Finance balance, transfer-direction and budget arithmetic | 20 tests, `tests/unit/finance.test.ts` |
| Finance end to end, incl. transfer rollback and id-ordering against real SQLite | 33 tests, `tests/integration/finance.test.ts` |
| Exchange-rate arithmetic across differing minor units | 33 tests, `tests/unit/rates.test.ts` |
| Rate storage, validation and converted totals | 20 tests, `tests/integration/exchangeRates.test.ts` |
| Local reminders: permission, scheduling, rehydration | 43 tests, `tests/integration/notifications.test.ts` |
| Recurrence rules and reminder text | 56 tests, `tests/integration/recurrence.test.ts` |
| Analytics periods, metrics and comparison | 44 tests, `tests/integration/analytics.test.ts` |
| Achievements evaluation and personal records | 38 tests, `tests/integration/achievements.test.ts` |
| Calendar projection across every domain | 25 tests, `tests/integration/calendar.test.ts` |
| Backup, restore and undo-restore | 42 tests, `tests/integration/backup.test.ts` |
| Secondary-module and Settings structural contracts | 21 tests, `tests/ui/secondaryModules.test.tsx` |

**Total: 1017 tests, 36 suites, all passing.**

## Implemented, not yet device-verified

These have real code behind them but have not been run on a simulator or device:

| Area | State |
|---|---|
| Expo Router navigation | `app/index.tsx` gate, `app/(tabs)/_layout.tsx`, `app/onboarding.tsx`, `app/manage.tsx`, `app/habit/[id].tsx`, `app/goal/[id].tsx`, `app/workout/[id].tsx` |
| Today dashboard | `app/(tabs)/index.tsx` — habits for today, today's and overdue tasks, progress bar, all-done state, and the secondary-module hub |
| Habits screens | `app/(tabs)/habits.tsx`, habit create sheet, habit detail with 14-day history |
| Goals screens | `app/(tabs)/goals.tsx`, goal create sheet, goal detail with milestones, tasks and lifecycle controls |
| Task state machine | `src/services/stateTransitions.ts` — pure, exhaustively tested |
| Design system | colours, typography, spacing, radii, motion; `AppText`, `Button`, `Card`, `Screen`, `Section`, `StateView`, `TextField`, `Swatch` |
| Theming | light / dark / system, resolved from persisted settings |
| Error boundary | `src/components/ErrorBoundary.tsx` with in-app log buffer |
| Settings persistence | `src/repositories/settingsRepository.ts`, resilient to corrupt JSON |
| Logging | `src/utils/logger.ts`, console silenced in release builds |
| Full database schema | 44 tables (42 application + 2 FTS5) across 15 migrations covering habits, goals, fitness, books, productivity, health, recovery, journal, finance, achievements, reminders and the sync outbox |
| PDF reader engine interface | `src/pdf/engine/types.ts` — per-document capability flags, discriminated open failures |
| PDF structure parser | `src/pdf/engine/pdfStructure.ts`, `documentReader.ts` — page count, geometry, info dictionary, encryption, table of contents |
| PDF engine implementation | `StructurePdfEngine`; reports `rendering: false` and `textSearch: false` honestly, because it does not rasterise or inflate streams |
| PDF import pipeline | `src/services/pdfImportService.ts` — copy to `.part`, validate, atomic rename, sweep orphans on launch |
| Book persistence | `src/repositories/booksRepository.ts` — books, reading sessions, bookmarks, highlights, notes, soft delete |
| File storage abstraction | `src/platform/storage/types.ts` — the only place the app touches the filesystem |
| Device storage adapter | `src/platform/storage/expoStorage.ts` — `expo-file-system` SDK 57 object API, with typed native-error classification |
| Books use-case layer | `src/services/booksService.ts` — two-phase import, progress clamping, annotation rules, delete ordering |
| Books UI | `app/(tabs)/books.tsx` library with document-picker import, `app/book/[id].tsx` reader with TOC, bookmarks, highlights and notes, `src/features/books/` |
| Focus timer arithmetic | `src/focus/timerMath.ts` — pure, clock-injected; survives backgrounding, suspension and a backwards device clock |
| Focus presets | `src/focus/presets.ts` — 25/5, 50/10, 90/20 plus validated custom lengths |
| Focus persistence | `src/repositories/focusRepository.ts` — sessions, wall-clock deadlines, derived totals, reviews |
| Focus use cases | `src/services/focusService.ts` — injectable clock, single-active-session rule, stale-session recovery |
| Focus UI | `app/(tabs)/focus.tsx`, `src/features/focus/`; interrupted sessions recovered on launch |
| Volume unit handling | `src/health/units.ts` — ml / litres / US fl oz, integer millilitres, typed-input parsing |
| Sleep arithmetic | `src/health/sleepMath.ts` — cross-midnight resolution, averages, spread; `sleep_date` is the wake day |
| Nutrition arithmetic | `src/health/nutritionMath.ts` — integer scaling by servings, macro split, 4/4/9 |
| Health persistence | `src/repositories/healthRepository.ts` — water, foods, nutrition entries, sleep; entries snapshot values |
| Health use cases | `src/services/healthService.ts` — validation at the boundary, injectable clock, no medical claims |
| Health UI | `app/(tabs)/hydration.tsx`, `nutrition.tsx`, `sleep.tsx`, `src/features/health/` |
| Recovery persistence | `src/repositories/recoveryRepository.ts` — daily ratings (energy, soreness, recovery, mood) and mobility sessions, migration 013 |
| Recovery arithmetic | `src/health/recoveryMath.ts`, `mobilityMath.ts` — per-rating averages, spread and trend; never interpreted |
| Recovery use cases | `src/services/recoveryService.ts` — 14-day report derived on read, injectable clock |
| Recovery UI | `app/recovery.tsx` — discrete 1-10 buttons (not a slider), mobility session logging |
| Journal tags | `src/journal/tags.ts` — JSON serialisation, de-duplication, legacy-value recovery |
| Journal search | `src/journal/search.ts` — FTS5 or `LIKE`, chosen at runtime; local only |
| Journal persistence | `src/repositories/journalRepository.ts` — entries, favourites, attachments |
| Journal use cases | `src/services/journalService.ts` — validation at the boundary; no network path exists |
| Journal UI | `app/(tabs)/journal.tsx`, `src/features/journal/`; reports which search engine ran |
| Journal export | `src/journal/export.ts` + `src/services/journalExportService.ts` — Markdown / JSON / CSV, body omitted by default, `.part` then atomic rename |
| Journal export UI | `app/settings/data.tsx` — format choice, saved-file list with sizes, delete |
| Journal lock | `src/platform/biometrics/` + `journalExportService` — in-memory unlock flag, re-locked on blur, never persisted |
| Finance transfer pairing | `src/finance/transfers.ts` — direction derivation, currency and same-account guards, netting invariant |
| Finance balances and budgets | `src/finance/balances.ts` — integer-only arithmetic, derived on read, transfers excluded from spend |
| Finance persistence | `src/repositories/financeRepository.ts` — accounts, categories, transactions, budgets; soft deletes |
| Finance use cases | `src/services/financeService.ts` — validation at the boundary, atomic transfer pair, injectable clock |
| Finance UI | `app/(tabs)/finance.tsx`, `src/features/finance/` — accounts with derived balances, expense/income/transfer, budget set and remove, recent activity |
| Multi-currency | `src/finance/rates.ts` — micro-scaled integer rates, exponent-aware conversion, sign-safe rounding |
| Exchange-rate persistence | `src/repositories/exchangeRateRepository.ts` — user-typed rates in `preferences`, both directions stored together |
| Exchange-rate use cases | `src/services/exchangeRateService.ts` — validation, conversion, and totals that *name* currencies they cannot convert |
| Currency UI | `app/settings/currency.tsx`, combined balance on `app/(tabs)/finance.tsx` |
| Analytics periods | `src/analytics/periods.ts` — local date keys, never UTC-derived; trailing periods, comparison |
| Analytics use cases | `src/services/analyticsService.ts` — metrics derived on read, summaries that describe and never judge |
| Analytics UI | `app/analytics.tsx` — period picker, pager, sparklines, period-over-period comparison |
| Achievements | `src/achievements/catalogue.ts`, `src/services/achievementsService.ts` — evaluation on write and on launch, personal records, gamification toggle |
| Achievements UI | `app/achievements.tsx` — grouped by category, progress bars, records, quiet mode |
| Calendar | `src/services/calendarService.ts` — projection over every domain table, nothing written back, capped range |
| Calendar UI | `app/calendar.tsx` — rolling window, day grouping, navigation only where a detail route exists |
| Reminders | `src/services/notificationService.ts` — permission, schedule, cancel, `rehydrate()` on launch |
| Reminder persistence | `src/repositories/remindersRepository.ts` — cadence rules, migration 014 |
| Reminder adapters | `src/platform/notifications/` — `NotificationAdapter` with a test seam and an unavailable fallback |
| Notification UI | `app/settings/reminders.tsx` — permission state, scheduled list, re-arm after update |
| Recurrence | `src/recurrence/` — cadence expansion, migration 014 |
| Backup and restore | `src/backup/format.ts`, `src/services/backupService.ts` — validated documents, deterministic export, transactional restore, safety backup, undo |
| Backup UI | `app/settings/data.tsx` — inspect-then-confirm restore, undo, journal exports |
| Settings hub | `app/settings/index.tsx` + `appearance`, `units`, `currency`, `reminders`, `privacy`, `data` |
| Biometric adapter | `src/platform/biometrics/` — `BiometricAdapter` returning a capability result, never throwing |

## NOT IMPLEMENTED

These are **not started**. Where the schema exists it is tested, but there is no
repository, service or UI. Listing them here is the point — the schema alone is not a
feature.

| Area | Schema | Feature code |
|---|---|---|
| Habits | yes | **yes** — implemented and tested |
| Goals, milestones, tasks | yes | **yes** — implemented and tested |
| Fitness: exercises, workouts, sets, body metrics | yes | **yes** — implemented and tested |
| Sports catalogue and sessions | yes | **yes** — 47 built-in sports, custom sports |
| Books / PDF library and reader | yes | **yes** — library, import and reader screens exist; the reader shows explicit unsupported states |
| PDF engine abstraction (`PDFReaderEngine`) | n/a | **yes** — interface plus `StructurePdfEngine` |
| PDF page rendering / text search | n/a | **no** — capabilities are reported `false` rather than faked (ADR-0006) |
| PDF reader themes (sepia, black) and page modes | n/a | **no** — both need a rendering capability the current engine lacks |
| PDF reader gestures: swipe paging, pinch-zoom, tap-to-hide-controls | n/a | **no** — the reader is a scrolling text view |
| Reader text search | n/a | **no** — the engine reports `textSearch: false` |
| Recurring-transaction creation UI | yes (migration 014) | **no** — cadence rules and reminders honour it; the finance screen does not yet offer it |
| Focus timer and reviews | yes | **yes** — presets, custom lengths, completion, abandonment, interruption recovery, daily/weekly/monthly/yearly reviews |
| Hydration, nutrition, sleep | yes | **yes** — quick-adds, ml/L/oz parsing, manual food DB, meals, snapshots, sleep logging with averages |
| Recovery ratings and mobility | yes (migration 013) | **yes** — energy, soreness, recovery, mood; six mobility kinds |
| Journal | yes | **yes** — entries, tags, favourites, local search, attachments, lock gate |
| Journal export | n/a | **yes** — Markdown, JSON and CSV to local files the user owns |
| Finance | yes | **yes** — accounts, transactions, atomic transfers, budget set/remove, multi-currency |
| Multi-currency conversion | n/a | **yes** — user-entered rates only; no rate feed by design |
| Recurring transactions | yes (migration 014) | **partial** — cadence rules and reminder text exist; the finance UI does not yet create a recurring transaction |
| Achievements and personal records | yes | **yes** — evaluation, unlock dates, records, gamification toggle |
| Notifications | yes | **yes** — permission, scheduling, cancellation, rehydration |
| Backup and restore | n/a | **yes** — export, inspect, restore, undo |
| Analytics and calendar | n/a | **yes** — both derived on read, no rollup table |
| Settings | yes | **yes** — appearance, units, currency, targets, reminders, privacy, data |
| Optional sync transport | yes | **no** (deliberate) |
| HealthKit / Health Connect adapters | n/a | **no** (deliberate) |
| Share sheet / document provider export of a backup | n/a | **no** — a backup is written into app storage; sharing it out is not implemented |
| At-rest journal encryption | n/a | **no** (deliberate) — the lock is an authentication gate, not encryption |

The `no` rows marked *deliberate* are intentional: the specification requires that optional
native integrations never be a prerequisite for core features, and no remote sync service
exists to talk to.

---

## Phase status against `START_DEVELOPMENT_TO_PRODUCTION.md`

| Phase | Status |
|---|---|
| 0 — Project audit | **VERIFIED** (`DEVELOPMENT/PROJECT_AUDIT.md`) |
| 1 — Foundation | **VERIFIED** for the parts covered by tests; native builds not run |
| 2 — Database and persistence | **VERIFIED** (schema v15, 15 migrations, 44 tables + schema integrity tests) |
| 3 — Design system | **VERIFIED**, accessibility contract tested |
| 4 — Onboarding and Today | **IMPLEMENTED**, not device-verified |
| 5 — Habits | **VERIFIED** end-to-end at the data layer, not device-verified |
| 6 — Goals and tasks | **VERIFIED** end-to-end at the data layer, not device-verified |
| 7 — Fitness | **VERIFIED** end-to-end at the data layer, not device-verified |
| 8 — Sports | **VERIFIED** end-to-end at the data layer, not device-verified |
| 9 — Books and PDF reader | **IMPLEMENTED**; page rendering and text search deliberately unimplemented |
| 10 — Productivity and focus | **VERIFIED** end-to-end at the data layer, not device-verified |
| 11 — Health tracking | **VERIFIED** end-to-end at the data layer, not device-verified |
| 12 — Journal | **VERIFIED** end-to-end at the data layer, not device-verified |
| 13 — Finance | **VERIFIED** end-to-end at the data layer, not device-verified |
| 14 — Analytics and achievements | **VERIFIED** end-to-end at the data layer, not device-verified |
| 15 — Notifications | **VERIFIED** end-to-end at the data layer, not device-verified |
| 16 — Backup and restore | **VERIFIED** end-to-end at the data layer, not device-verified |
| 17 — Optional synchronisation | outbox schema only, by design |
| 18 — Security audit | partial (see `SECURITY/SECURITY.md` notes) |
| 19 — Performance audit | not started |
| 20 — Accessibility audit | partial — automated contract tests only, no device/VoiceOver pass |
| 21 — Cross-platform testing | **blocked on a macOS host and an Android emulator** |
| 22 — Release candidate | not started |
| 23 — Production release | not started |

## Blockers outside this environment

1. **iOS verification is impossible on this Linux host.** Phases 21–23 require macOS with
   Xcode. This is a structural limitation, not a to-do item. Recorded as
   `DEVELOPMENT/KNOWN_ISSUES.md` ISSUE-002.
2. **Android runtime verification needs an emulator** to be provisioned; no AVD exists.

Choosing a rasterising PDF engine is the single change that would unblock five reader gaps
at once (page rendering, text search, zoom, page modes and reader themes). It is a
dependency decision, not a code change, and is recorded in `DEVELOPMENT/SPEC_TRACEABILITY.md`.

## The honest summary

Every feature slice the specification names now has code behind it: habits; goals with
milestones and tasks; fitness and sports; books and the PDF reader; focus; hydration,
nutrition and sleep; recovery; the journal with export and a lock; finance with
multi-currency; analytics; achievements; calendar; reminders; and backup and restore.
**1017 tests pass, typecheck and lint are clean.**

What has *not* happened is the thing that cannot happen here: nothing has been run on an
iOS or Android device. Every "VERIFIED" above means a command passed in this environment,
and no more. The PDF reader deliberately reports that it cannot render pages or search
text. Optional sync, HealthKit/Health Connect and at-rest encryption are absent by design
rather than by omission.
