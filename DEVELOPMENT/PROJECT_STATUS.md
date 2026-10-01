# PROJECT STATUS — HONEST COMPLETION LEDGER

This file exists to prevent the single worst outcome for this project: a partially
built application described as finished.

Rules for this file:
- A phase is **VERIFIED** only if a command was run and passed.
- **IMPLEMENTED** means the code exists and is wired up, but has not been exercised on
  a real device.
- **NOT IMPLEMENTED** means there is no code. These are not stubs or placeholders.
- No item is marked VERIFIED on the basis of having been written.

Last updated: 2026-01-10

---

## Verified (command run, passed)

| Area | Evidence |
|---|---|
| Strict TypeScript compilation of the whole project | `npm run typecheck` exit 0 |
| Lint across the whole project | `npm run lint`, zero warnings |
| Migration engine against real SQLite | 12 tests, `tests/integration/migrations.test.ts` |
| Schema integrity guarantees | 20 tests, `tests/integration/schema.test.ts` |
| Habit vertical slice (DB + repository + service + logic) | 19 tests, `tests/integration/habits.test.ts` |
| Goals / milestones / tasks slice, incl. state machine | 49 tests across `tests/integration/goals.test.ts` and `tests/unit/stateTransitions.test.ts` |
| Fitness slice: sets, workouts, body metrics, sports | 57 tests across `tests/integration/fitness.test.ts` and `tests/unit/units.test.ts` |
| Money arithmetic correctness | 20 tests, `tests/unit/money.test.ts` |
| Local-calendar date correctness | 16 tests, `tests/unit/dates.test.ts` |
| Design-system accessibility contract | 29 tests, `tests/ui/components.test.tsx` |
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
| Journal tags and search-query construction | 20 tests, `tests/unit/journal.test.ts` |
| Journal end to end, including the privacy assertion | 33 tests, `tests/integration/journal.test.ts` |
| Finance balance, transfer-direction and budget arithmetic | 20 tests, `tests/unit/finance.test.ts` |
| Finance end to end, including transfer rollback and id-ordering against real SQLite | 33 tests, `tests/integration/finance.test.ts` |
| Finance UI contracts: spoken amounts and no decimal money in components | 11 tests, `tests/ui/finance.test.tsx` |
| Button selection state for assistive tech | 4 tests, `tests/ui/components.test.tsx` |

**Total: 622 tests, 25 suites, all passing.**

## Implemented, not yet device-verified

These have real code behind them but have not been run on a simulator or device:

| Area | State |
|---|---|
| Expo Router navigation | `app/index.tsx` gate, `app/(tabs)/_layout.tsx`, `app/onboarding.tsx`, `app/manage.tsx`, `app/habit/[id].tsx`, `app/goal/[id].tsx` |
| Today dashboard | `app/(tabs)/index.tsx` — habits for today, today's and overdue tasks, progress bar, all-done state |
| Habits screens | `app/(tabs)/habits.tsx`, habit create sheet, habit detail with 14-day history |
| Goals screens | `app/(tabs)/goals.tsx`, goal create sheet, goal detail with milestones, tasks and lifecycle controls |
| Task state machine | `src/services/stateTransitions.ts` — pure, exhaustively tested |
| Design system | colours, typography, spacing, radii, motion; `AppText`, `Button`, `Card`, `Screen`, `Section`, `StateView`, `TextField`, `Swatch` |
| Theming | light / dark / system, resolved from persisted settings |
| Error boundary | `src/components/ErrorBoundary.tsx` with in-app log buffer |
| Settings persistence | `src/repositories/settingsRepository.ts`, resilient to corrupt JSON |
| Logging | `src/utils/logger.ts`, console silenced in release builds |
| Full database schema | 31 tables across 12 migrations covering habits, goals, fitness, books, productivity, health, journal, finance, achievements and the sync outbox |
| PDF reader engine interface | `src/pdf/engine/types.ts` — per-document capability flags, discriminated open failures |
| PDF structure parser | `src/pdf/engine/pdfStructure.ts`, `documentReader.ts` — page count, geometry, info dictionary, encryption, table of contents |
| PDF engine implementation | `StructurePdfEngine`; reports `rendering: false` and `textSearch: false` honestly, because it does not rasterise or inflate streams |
| PDF import pipeline | `src/services/pdfImportService.ts` — copy to `.part`, validate, atomic rename, sweep orphans on launch |
| Book persistence | `src/repositories/booksRepository.ts` — books, reading sessions, bookmarks, highlights, notes, soft delete |
| File storage abstraction | `src/platform/storage/types.ts` — the only place the app touches the filesystem |
| Device storage adapter | `src/platform/storage/expoStorage.ts` — `expo-file-system` SDK 57 object API, with typed native-error classification |
| Books use-case layer | `src/services/booksService.ts` — two-phase import, progress clamping, annotation rules, delete ordering |
| Books UI | `app/(tabs)/books.tsx` library with document-picker import, `app/book/[id].tsx` reader, `src/features/books/` |
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
| Journal tags | `src/journal/tags.ts` — JSON serialisation, de-duplication, legacy-value recovery |
| Journal search | `src/journal/search.ts` — FTS5 or `LIKE`, chosen at runtime; local only |
| Journal persistence | `src/repositories/journalRepository.ts` — entries, favourites, attachments |
| Journal use cases | `src/services/journalService.ts` — validation at the boundary; no network path exists |
| Journal UI | `app/(tabs)/journal.tsx`, `src/features/journal/`; reports which search engine ran |
| Finance transfer pairing | `src/finance/transfers.ts` — direction derivation, currency and same-account guards, netting invariant |
| Finance balances and budgets | `src/finance/balances.ts` — integer-only arithmetic, derived on read, transfers excluded from spend |
| Finance persistence | `src/repositories/financeRepository.ts` — accounts, categories, transactions, budgets; soft deletes |
| Finance use cases | `src/services/financeService.ts` — validation at the boundary, atomic transfer pair, injectable clock |
| Finance UI | `app/(tabs)/finance.tsx`, `src/features/finance/` — accounts with derived balances, expense/income/transfer, monthly budgets, recent activity |

## NOT IMPLEMENTED

These are **not started**. The schema for most of them exists and is tested, but there
is no repository, service or UI. Listing them here is the point — the schema alone is
not a feature.

| Area | Schema | Feature code |
|---|---|---|
| Goals, milestones, tasks | yes | **yes** — implemented and tested |
| Fitness: exercises, workouts, sets, body metrics | yes | **yes** — implemented and tested |
| Sports catalogue and sessions | yes | **yes** — 47 built-in sports, custom sports |
| Books / PDF library and reader | yes | **yes** — library, import and reader screens exist; the reader shows explicit unsupported states |
| PDF engine abstraction (`PDFReaderEngine`) | n/a | **yes** — interface plus `StructurePdfEngine`; a rasterising engine is still unselected |
| PDF page rendering / text search | n/a | **no** — capabilities are reported `false` rather than faked (ADR-0006) |
| Focus timer and reviews | yes | **yes** — presets, custom lengths, completion, abandonment, interruption recovery, daily/weekly/monthly/yearly reviews |
| Hydration, nutrition, sleep | yes | **yes** — quick-adds, ml/L/oz parsing, manual food DB, meals, snapshots, sleep logging with averages |
| Recovery ratings (energy, soreness, mood) | **no table exists** | **no** — needs migration 013; `FEATURES/HEALTH.md` specifies it but migration 007 has no schema |
| Journal | yes | **yes** — entries, tags, favourites, local search (FTS5 or LIKE), attachments; no sync or export |
| Journal export | n/a | **no** — requires an explicit user-chosen destination, not a silent transmit |
| Journal app lock | yes (SecureStore) | **no** — UI gate only, and explicitly not at-rest encryption |
| Finance | yes | **partial** — accounts, transactions, atomic transfers, budgets and the UI are implemented and tested; **no multi-currency conversion**, no budget editing UI, no recurring transactions |
| Achievements and personal records | yes | **no** |
| Notifications | yes | **no** |
| Backup and restore | n/a | **no** |
| Optional sync transport | yes | **no** (deliberate) |
| HealthKit / Health Connect adapters | n/a | **no** (deliberate) |
| Biometrics adapter | n/a | **no** (deliberate) |

The last three are intentional: the specification requires that optional native
integrations never be a prerequisite for core features, and no remote sync service
exists to talk to.

---

## Phase status against `START_DEVELOPMENT_TO_PRODUCTION.md`

| Phase | Status |
|---|---|
| 0 — Project audit | **VERIFIED** (`DEVELOPMENT/PROJECT_AUDIT.md`) |
| 1 — Foundation | **VERIFIED** for the parts covered by tests; native builds not run |
| 2 — Database and persistence | **VERIFIED** (migrations + schema + habits) |
| 3 — Design system | **IMPLEMENTED**, accessibility contract tested |
| 4 — Onboarding and Today | **IMPLEMENTED**, not device-verified |
| 5 — Habits | **VERIFIED** end-to-end at the data layer, not device-verified |
| 6 — Goals and tasks | **VERIFIED** end-to-end at the data layer, not device-verified |
| 7 — Fitness | **VERIFIED** end-to-end at the data layer, not device-verified |
| 8 — Sports | **VERIFIED** end-to-end at the data layer, not device-verified |
| 9 — Books and PDF reader | not started |
| 10 — Productivity and focus | not started |
| 11 — Health tracking | not started |
| 12 — Journal | not started |
| 13 — Finance | not started |
| 14 — Analytics and achievements | not started |
| 15 — Notifications | not started |
| 16 — Backup and restore | not started |
| 17 — Optional synchronisation | outbox schema only, by design |
| 18 — Security audit | partial (see `SECURITY/SECURITY.md` notes) |
| 19 — Performance audit | not started |
| 20 — Accessibility audit | partial — automated contract tests only, no device/VoiceOver pass |
| 21 — Cross-platform testing | **blocked on a macOS host** |
| 22 — Release candidate | not started |
| 23 — Production release | not started |

## Blockers outside this environment

1. **iOS verification is impossible on Windows.** Phases 21–23 require it. A macOS
   host with Xcode is needed. This is a structural limitation, not a to-do item.
2. **Android runtime verification needs `adb` and an emulator** to be provisioned.

## The honest summary

What exists is a real, tested foundation with four complete feature slices (habits;
goals with milestones and tasks; fitness with workouts, sets and body metrics; and a
47-sport catalogue with sessions). What does not exist is most of the product. The
schema for the remaining features is written and tested, which is genuine progress and
not wasted work — it is the part that is expensive to get wrong — but a schema is not a
feature, and this file refuses to describe it as one.
