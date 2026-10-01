# LifeOS Development Changelog

This is the engineering history used by future AI sessions.

## Rules

Record meaningful changes, not every trivial edit.

Include:

- date
- change
- reason
- affected modules
- migrations
- platform impact
- tests performed

## Entry format

### YYYY-MM-DD — Change title

Change:

Reason:

Affected areas:

Database/migration:

Platforms:

Verification:

Follow-up:

### 2026-01-10 — Phase 13, part 2: finance UI; fixed a non-deterministic transfer direction

**Change.** Added the Finance screen (`app/(tabs)/finance.tsx`) and its hook layer
(`src/features/finance/hooks/useFinance.ts`), registered an eleventh tab, and added
`tests/ui/finance.test.tsx`. In doing so, **fixed a real bug in the transfer pairing from
part 1**.

**Reason.** The bug: `recordTransfer` generated the source and target leg ids in call order,
but ids are random UUIDv4 and direction is derived from which id sorts first. Roughly half
of all transfers therefore stored the pair inverted — money appeared to leave the
*destination* account. It survived the first phase's tests because the `transferNetsToZero`
conservation invariant does not detect an inversion: the total across accounts is unchanged
either way. Only a per-account assertion caught it, and only when a full-suite run happened
to generate an inverted pair. The ids are now compared before assignment so the convention
holds by construction, and a deterministic test installs a descending id generator to force
the previously-failing case rather than leaving it to luck. Recorded as EDGE-0033.

**The UI's own rule.** No decimal currency reaches a component. The amount a user types stays
a string until the service parses it, and `tests/ui/finance.test.tsx` asserts structurally
over the source that the screen contains no `Number(amount)`, no `parseFloat`, no `* 100`
and no repository import — the same technique the journal privacy test uses, because a
comment decays and a test does not.

**Affected areas.** `app/(tabs)/finance.tsx`, `app/(tabs)/_layout.tsx`,
`src/features/finance/hooks/useFinance.ts`, `src/services/financeService.ts`,
`tests/ui/finance.test.tsx`, `tests/integration/finance.test.ts`.

**Database/migration.** None.

**Platforms.** No platform-specific code. Eleven tabs now exist; the tab bar scrolls, but
this is worth watching as more features land.

**Verification.** `tsc --noEmit` exit 0; `eslint` exit 0 with zero warnings; full suite
**622 tests / 25 suites** passing. The finance integration suite was run six consecutive
times to confirm the direction fix is stable rather than probabilistic.

**Follow-up.** Budgets are read-only in the UI — `setBudget` exists and is tested but has no
screen. There is also no multi-currency conversion (deliberate, see EDGE-0032) and no
recurring transactions.

### 2026-01-10 — Phase 13: finance domain layer (accounts, transactions, atomic transfers, budgets)

**Change.** Implemented the finance slice below the UI: `src/finance/transfers.ts` (transfer
direction, validation, netting invariant), `src/finance/balances.ts` (integer-only balance
and budget arithmetic), `src/repositories/financeRepository.ts` (accounts, categories,
transactions, budgets) and `src/services/financeService.ts` (validation at the boundary,
atomic transfer pair, injectable clock). No UI yet.

**Reason.** Finance is the area the specification flags as most likely to be faked, because
"a ledger" looks finished while quietly using floats. Three decisions carry the correctness:
amounts are INTEGER minor units everywhere and user input is parsed from the decimal
*string*, never `parseFloat`; a transfer's two legs are written in one transaction with a
`ROLLBACK`, because half a transfer is worse than a failed one; and balances and budget
spend are derived on read rather than stored, so an edit or delete cannot leave a stale
total.

**Affected areas.** `src/finance/*`, `src/repositories/financeRepository.ts`,
`src/services/financeService.ts`, `tests/unit/finance.test.ts`,
`tests/integration/finance.test.ts`.

**Database/migration.** None. Migration 009 was already in place and is unchanged — ADR-0007
keeps released migrations immutable. Two schema gaps were found and handled in code rather
than by editing shipped SQL; both are recorded as EDGE-0029 and EDGE-0032.

**Platforms.** No platform-specific code. Money is currency-code driven, so PHP, USD, EUR
and any ISO-4217 code work identically on both platforms, including zero-decimal (JPY) and
three-decimal (KWD) currencies.

**Verification.** `tsc --noEmit` exit 0; `eslint` exit 0; full suite **610 tests / 24
suites** passing. 20 unit tests on arithmetic, 32 integration tests through real SQLite.
The integration suite includes a deliberately injected failure on the second transfer insert
to prove the rollback leaves no orphan.

**Follow-up.** No `app/(tabs)/finance.tsx` yet — the Finance row in `PROJECT_STATUS.md` is
marked *partial* for this reason. The transfer direction convention (lexicographically
smaller id is the source) is a documented workaround for a missing `direction` column; if it
proves confusing in use, fix it with a new migration rather than a subtler rule.

### 2026-01-10 — Phase 9: PDF parser, engine interface, import pipeline, book persistence

**Change.** Implemented the Books/PDF slice below the UI: a real PDF structure parser, the
`PDFReaderEngine` interface with per-document capability flags, a `StructurePdfEngine`
implementation, a crash-safe import pipeline, a `StorageAdapter` abstraction, and a
`booksRepository` covering books, reading sessions, bookmarks, highlights and notes.

**Reason.** The specification's failure list for PDF handling (corrupt, encrypted, huge,
missing, moved, deleted, invalid extension, interrupted import, insufficient storage) is
the part most likely to be faked or ignored. Each case is now a typed result with a named
test. Capabilities are measured from the bytes, so an unsupportable document reports
`false` rather than a control that silently does nothing (ADR-0006).

**Affected areas.** `src/pdf/engine/`, `src/platform/storage/`, `src/services/pdfImportService.ts`,
`src/repositories/booksRepository.ts`, `tests/support/{memoryStorage,pdfFixture}.ts`,
`tests/integration/{pdf,books}.test.ts`.

**Database/migration.** None. Migration 005 already defined `books`, `reading_sessions`,
`bookmarks`, `highlights` and `book_notes`; this phase adds the code that uses them.

**Platforms.** No platform adapter is wired yet. `StorageAdapter` currently has one
implementation, the in-memory test double. The `expo-file-system` adapter and the reader
screens are outstanding, so the library is not yet reachable from the app.

**Verification.** `npm run typecheck` exit 0; `npm run lint` zero warnings;
`npm test` 287 tests across 12 suites, all passing. PDF work is verified against real PDF
bytes generated by `tests/support/pdfFixture.ts`, and book persistence against real
SQLite via `node:sqlite`.

**Follow-up.** Select and evaluate a rasterising engine; write the `expo-file-system`
adapter; build the library, import and reader screens with explicit unsupported states.

---

### 2026-01-10 — Phase 9, part 2: device storage adapter, use-case layer and Books UI

**Change.** Added `ExpoStorageAdapter` (`expo-file-system` SDK 57 object API), the
`booksService` use-case layer with two-phase import, the Books library tab, the reader
screen, and the interrupted-import sweep on launch.

**Reason.** The previous phase left the feature unreachable: the parser, engine and
repository existed, but nothing touched a real device filesystem and there were no
screens. This closes that gap and puts the ADR-0017 ordering in the only place that can
enforce it — a single `commitImport` that no screen can bypass.

**Affected areas.** `src/platform/storage/expoStorage.ts`, `src/services/booksService.ts`,
`src/features/books/`, `app/(tabs)/books.tsx`, `app/book/[id].tsx`, `app/(tabs)/_layout.tsx`,
`app/_layout.tsx`, `jest.config.js`, `tests/support/expoFileSystemStub.ts`.

**Database/migration.** None. Migration 005 is sufficient.

**Platforms.** Both. The adapter uses the SDK 57 `File` / `Directory` / `Paths` API rather
than the legacy functional one, and handles Android `content://` picker URIs as well as
`file://`.

**Verification.** `npm run typecheck` exit 0; `npm run lint` zero warnings; `npm test`
348 tests across 15 suites. The adapter is tested against a fake `expo-file-system`
mirroring the real API, so its path handling and error classification are covered
off-device. Device runtime is still unverified.

**Follow-up.** Select and evaluate a rasterising engine; verify import on a real iOS and
Android device; add the reader's page-render and text-search surfaces once an engine
exists.

---

### 2026-01-10 — Phase 10: productivity and focus; fixed an ISO week bug in `isoWeekKey`

**Change.** Added the focus timer and reviews: pure timer arithmetic, presets, the
`focus_sessions`/`reviews` repository, the focus use-case layer with an injectable clock,
the Focus tab, and stale-session recovery on launch. Separately, **fixed an off-by-one bug
in `isoWeekKey`** that the Phase 10 work exposed.

**The bug.** `isoWeekKey` shifted the date by a fixed `+3` days to reach the ISO week's
Thursday. For a Thursday that lands on the *Sunday* of the same week, so every Thursday
and every day after it was filed a week too high: `2026-01-08` returned `2026-W03` instead
of `2026-W02`, and `2026-01-01` returned `2026-W02` instead of `2026-W01`.

The existing tests asserted only the *shape* of the key (`/^2026-W\d{2}$/`), never the
number, so the off-by-one passed review. The correct shift is `- dayNumber + 3`, where
`dayNumber` is the Monday-based weekday index. Tests now assert exact week numbers across
year boundaries, including a 53-week year (2026) and a 52-week year (2024).

**Why it matters.** `isoWeekKey` files **weekly reviews** and **budgets**. A week filed
under the wrong number is data the user cannot find again, and the error is silent.

**Affected areas.** `src/focus/`, `src/repositories/focusRepository.ts`,
`src/services/focusService.ts`, `src/features/focus/`, `app/(tabs)/focus.tsx`,
`app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `src/utils/dates.ts`,
`tests/unit/focus.test.ts`, `tests/integration/focus.test.ts`, `tests/ui/focus.test.tsx`,
`tests/unit/dates.test.ts`.

**Database/migration.** None. Migration 006 already defined `focus_sessions` and
`reviews`; this phase adds the code that uses them.

**Verification.** `npm run typecheck` exit 0; `npm run lint` zero warnings; `npm test`
427 tests across 18 suites. Timer behaviour is verified by moving an injected clock rather
than waiting, so process-kill, reopen-late and backwards-clock cases are deterministic.

**Follow-up.** Local notifications when a session ends (Phase 15); recurring tasks and
daily planning; Analytics integration.

---

### 2026-01-10 — Phase 11: hydration, nutrition and sleep

**Change.** Added the health slice: volume-unit handling, sleep-window arithmetic,
nutrition arithmetic, the `water_logs` / `foods` / `nutrition_entries` / `sleep_logs`
repository, a health use-case layer with an injectable clock, and three screens (Water,
Food, Sleep) wired into the tab bar.

**Reason.** `FEATURES/HEALTH.md`, `HYDRATION.md`, `NUTRITION.md` and `SLEEP.md` all exist
and migration 007 defined the tables, but nothing used them. Hydration also had to support
ml, litres and ounces with integer millilitre storage, which is the kind of conversion
that is easy to get subtly wrong.

**Design decisions worth recording:**

- **`sleep_date` is the wake-up date.** A bedtime whose clock time is later than the wake
  time belongs to the previous evening. Without this, a 23:00 → 07:00 night cannot satisfy
  the schema's `CHECK (wake_time >= bedtime)` at all, because both times would have to
  share one date. The convention is stated once in `sleepMath.ts` and covered by tests.
- **Nutrition entries snapshot their values** rather than referencing the `foods` row.
  A test edits a food after logging it and asserts against the raw columns, because
  "editing a food never rewrites history" is exactly the kind of promise that decays
  silently.
- **No medical claims.** `HEALTH.md` forbids diagnosis or advice. Nothing in the service
  interprets a value or recommends anything. Hydration progress is capped at 100% rather
  than showing 140%, precisely so the UI does not imply that more water is better. The
  sleep "consistency" figure is the observed spread in minutes, not a score, and it
  returns `null` below three nights instead of inventing a number from too little data.
- **Fluid ounces are rounded to whole millilitres**, because `amount_ml` is INTEGER and a
  US fluid ounce is `29.5735295625 ml` exactly. The sub-0.5 ml cost is documented in
  `units.ts` and bounded by a test.

**Two bugs found by tests, both in code I had just written:**

- `resolveSleepWindow` compared two parsed *objects* with `>`, which stringifies both to
  `"[object Object]"` and is always false. Every cross-midnight night was therefore
  treated as a same-day one — the exact case the feature exists to handle. Fixed by
  comparing minutes since midnight.
- My own test claimed that four quarter-servings re-sum to one whole serving. They do not:
  15.0 g of protein over four servings is 3.75 g, which is not a whole tenth of a gram, so
  rounding loses up to 0.05 g per entry. The claim was wrong, not the code. The test now
  asserts a bounded error, and `scaleNutrition` documents that it makes no such promise.

**Gap found and left explicit.** `FEATURES/HEALTH.md` also specifies recovery ratings
(energy, soreness, recovery, mood). **Migration 007 has no recovery table**, so there is
nothing to build on. This is recorded in `PROJECT_STATUS.md` as needing migration 013
rather than being quietly skipped or half-built.

**Affected areas.** `src/health/`, `src/repositories/healthRepository.ts`,
`src/services/healthService.ts`, `src/features/health/`, `app/(tabs)/{hydration,nutrition,sleep}.tsx`,
`app/(tabs)/_layout.tsx`, `tests/unit/health.test.ts`, `tests/integration/health.test.ts`.

**Database/migration.** None. Migration 007 was sufficient for the three domains built.

**Verification.** `npm run typecheck` exit 0; `npm run lint` zero warnings; `npm test`
501 tests across 20 suites.

**Follow-up.** Migration 013 for recovery ratings; text-entry sheet for hydration units;
a configurable daily water target (currently the `DEFAULT_DAILY_TARGET_ML` constant, as no
setting exists); HealthKit / Health Connect adapters remain deliberately deferred.

---

### 2026-01-10 — Phase 12: journal, with a structural privacy test

**Change.** Added the journal: tag handling, capability-aware local search, the
`journal_entries` / `journal_attachments` repository, a use-case layer, and the Journal tab
with create, edit, favourite, tag, search and delete.

**Privacy is the load-bearing decision here.** `FEATURES/JOURNAL.md` requires that journal
contents are never transmitted silently. A promise in a comment decays the first time
somebody adds an import, so it is asserted structurally instead: a test walks the journal
module graph from `src/journal/*` and `src/services/journalService.ts` and fails if any
networking library appears, and a second test asserts the service exports no
`export function sync|share|upload|publish|send`. Both are cheap and would catch a
regression that no review of a diff would necessarily flag.

Related honesty point: entries are stored **unencrypted** in the app sandbox, and the
optional lock is a UI gate backed by SecureStore. Nothing in the code or the docs claims
at-rest encryption, and `PROJECT_STATUS.md` records the lock as unimplemented for that
reason.

**Design decisions:**

- **Tags are a JSON array, not a delimited string.** A delimiter is data: a user can type a
  comma in a tag, and a naive join would parse back into different tags. JSON round-trips
  exactly and the FTS5 index still tokenises the words, because it indexes text.
  `parseTags` degrades gracefully on a malformed value — losing access to the user's own
  writing because a tag string is odd would be far worse than losing the tags.
- **Search is capability-aware, and says so.** FTS5 is used when the build has it and
  `LIKE` when it does not. The screen states when it fell back, because the fallback is
  genuinely slower and the user deserves to know rather than assume the fast path ran.
  Both paths are tested against real SQL, because a fallback nobody tests does not work on
  the Android builds that need it.
- **`Button` gained a `selected` prop.** A toggle whose state is shown only by its variant
  is a state conveyed by colour alone, which fails the project's own accessibility rule.
  Four tests cover it.

**Two bugs found, both mine:**

- **`searchEntries` used `SELECT *`, which does not include SQLite's implicit `rowid`.**
  The FTS5 path returned correct row ids, the re-join query then fetched rows with
  `rowid: undefined`, and every search silently returned nothing. Found by adding a
  temporary diagnostic test that printed the capability row, the raw `LIKE` result and the
  FTS result side by side — the FTS query answered correctly while the search returned
  empty, which pointed straight at the re-join. Fixed by selecting `rowid` explicitly.
- A line-number-based edit inserted a function mid-block and scrambled `journal.tsx`;
  caught by typecheck and repaired. Prefer the editor's targeted replacement over
  line-number inserts for large files.

**Affected areas.** `src/journal/`, `src/repositories/journalRepository.ts`,
`src/services/journalService.ts`, `src/features/journal/`, `app/(tabs)/journal.tsx`,
`app/(tabs)/_layout.tsx`, `src/components/Button.tsx`,
`tests/unit/journal.test.ts`, `tests/integration/journal.test.ts`,
`tests/ui/components.test.tsx`.

**Database/migration.** None. Migrations 008 and 012 were sufficient.

**Verification.** `npm run typecheck` exit 0; `npm run lint` zero warnings; `npm test`
558 tests across 22 suites.

**Follow-up.** Journal export needs an explicit user-chosen destination and is deliberately
not implemented; the SecureStore-backed app lock; entry detail screen with attachments
browsing; calendar view (`JOURNAL.md` lists a calendar, which is not built).

---

## Important

Do not rewrite history to make the project look cleaner. Preserve useful historical context.

---

## 2026-01-10 — Foundation, schema and first feature slice

### Project scaffolding

**Change.** Expo SDK 57.0.26, React Native 0.86.3, React 19.2.3, Expo Router 57.
Strict TypeScript with `noUncheckedIndexedAccess`, `noImplicitOverride` and unused checks.
ESLint flat config on `eslint-config-expo` with a zero-warning gate. Jest with two
projects: `node` (logic, real SQLite) and `expo` (components). `.gitignore` covers
secrets, native builds, logs and `.env*`.

**Reason.** The repository previously contained no code at all; see `PROJECT_AUDIT.md`.

**Verification.** `npm run typecheck` exit 0; `npm run lint` zero warnings.

### Database

**Change.** `SqlDriver` interface with two implementations: `ExpoSqlDriver` (WAL,
foreign keys on, busy timeout) for the device, and `NodeSqliteDriver` over Node 22's
built-in `node:sqlite` for tests. Transactional migration runner, `user_version`
advancing only after commit, refusal of future schemas, pre-migration hook, and
capability-gated FTS5. Twelve migrations, thirty-one tables.

**Reason.** The specification forbids a migration silently erasing data, and requires
migrations to be tested. Mocking SQLite would mean the tested SQL is not the shipped SQL.

**Affected areas.** `src/database/**`, `tests/integration/migrations.test.ts`,
`tests/integration/schema.test.ts`.

**Verification.** 32 tests against a real SQLite engine, including a deliberately broken
migration that rolls back and leaves the version untouched.

### Feature: Habits

**Change.** Complete vertical slice: types, repository, service, hooks and UI. Create
with validation, edit, archive, restore, soft delete, complete/undo with per-day
history, a 14-day correction view, and streaks recomputed from history. Today
dashboard, habit management screen and habit detail screen.

**Reason.** Phase 5 of the specification, built end-to-end rather than UI-first.

**Verification.** 19 integration tests through service -> repository -> real SQLite.

**Platforms.** Shared code; no platform branches.

### Design system

**Change.** Colour, typography, spacing, radius and motion tokens; light, dark and system
appearance; `AppText`, `Button`, `Card`, `Screen`, `Section`, `StateView`, `TextField`,
`Swatch`. 48pt minimum touch target, font scaling honoured and capped, state never
conveyed by colour alone.

**Verification.** 15 component tests asserting roles, labels, hints, states and token
resolution.

### Fixed

- **ISSUE-001 — habit completion lost under rapid duplicate taps.** `logCompletion` did
  SELECT-then-INSERT, so two concurrent taps both saw no row and one threw a UNIQUE
  violation. Replaced with an atomic `INSERT ... ON CONFLICT DO NOTHING` plus read-back
  (ADR-0009). Regression test: "is idempotent under rapid duplicate taps". A unique
  index prevents the duplicate row but does not make check-then-act safe — the losing
  caller got an exception instead of a successful no-op.
- Finance migration 009 referenced a non-existent table
  (`accounts_order_placeholder`); caught by the migration tests before it ever shipped.
- `useAsyncResource` wrote a ref during render, unsafe under concurrent React; moved
  into an effect.
- `useAsyncResource` set state synchronously in an effect on first load, causing a
  cascading render; the initial load now relies on the existing `loading` state.
- `ErrorBoundary` members lacked `override` under `noImplicitOverride`.

### Documentation

`PROJECT_AUDIT.md`, `BASELINE.md`, `PROJECT_STATUS.md`, `DECISIONS.md` (ADR-0001 to
ADR-0010), `KNOWN_ISSUES.md`, `EDGE_CASES.md`, and repairs to five documents that had
been written with literal `` `n `` sequences instead of real newlines.

### Not done

Stated plainly so it is not mistaken for an oversight: goals, fitness, sports, books and
the PDF reader, productivity and focus, health tracking, journal, finance, analytics,
notifications, backup/restore and sync are **not implemented**. Their tables exist and
are tested; a schema is not a feature. See `PROJECT_STATUS.md`.

**Follow-up.** Continue with goals and tasks (Phase 6), then fitness (Phase 7).

---

## 2026-01-10 — Phase 6: Goals, milestones and tasks

### Feature: Goals / milestones / tasks

**Change.** Complete vertical slice following the same pattern as habits: types,
repository, service, hooks, components, screens. Goals carry a lifecycle
(active, paused, completed, cancelled, archived), milestones break a goal into steps,
and tasks attach to a goal or a milestone. Today now shows today's and overdue tasks
alongside habits, as `FEATURES/GOALS.md` requires.

**Reason.** Phase 6 of the specification, including the explicit rule "Do not allow
invalid state transitions."

**Design.** `src/services/stateTransitions.ts` is a pure module holding the only
transition tables, so the rule is testable without a database and the goal detail screen
renders its buttons directly from the table — the UI cannot offer a move the domain
would reject (ADR-0011). A status meaning "finished" (`completed`, `cancelled`) is only
reversible through `archived`, so reopening cannot erase the fact that it finished.

**Progress.** Derived from milestones rather than maintained by hand: `progress_pct` is
recomputed after every milestone change, and a manual percentage is refused with an
explanation once milestones exist (ADR-0012).

**Verification.** 49 new tests: 30 integration (`tests/integration/goals.test.ts`,
service -> repository -> real SQLite) and 19 unit
(`tests/unit/stateTransitions.test.ts`, which classifies *every* state pair so an
undeclared transition is provably rejected). Total suite now 161 tests across 8 files.

### Fixed

- **ISSUE-003 — overdue tasks never appeared.** `plannedDate` was bound to two mutually
  exclusive predicates in one WHERE clause (`planned_date = ?` and
  `planned_date < ?` against the same value), so the query could never match. The list
  came back empty with no error, which is exactly the kind of silent failure that ships.
  `overdueOnly` now reinterprets `plannedDate` as the reference day and skips the
  equality clause. Regression tests added.
- `ValidationError` was defined inside `habitsService`, which would have forced
  `goalsService` to import from the habits feature. Extracted to
  `src/services/errors.ts` so features stay independent.
- Goal list counts were fetched with separate queries that could render an
  inconsistent snapshot; now correlated subqueries in one round trip.

### Documentation

ADR-0011 and ADR-0012 added; `PROJECT_STATUS.md`, `BASELINE.md` and `KNOWN_ISSUES.md`
updated with the new totals and ISSUE-003.

### Follow-up

Phase 7, fitness: exercises, workouts, sets and body metrics, reusing the single
`workouts`/`workout_sets` model already in the schema rather than building per-sport
systems.

---

## 2026-01-10 — Phase 7/8: Fitness, workouts and sports

### Reference data

**Change.** 43 seeded exercises and 47 seeded sports as typed modules in `src/data/`,
inserted idempotently after migrations by `src/database/seed.ts` using
`ON CONFLICT DO NOTHING`. Every sport the specification lists is present.

**Reason.** The catalogues are data, not schema, and ADR-0007 makes released migrations
immutable — adding an exercise by editing migration 004 would break that rule (ADR-0015).

### Feature: workouts and sets

**Change.** One activity architecture covering gym, home workouts, mobility, stretching
and cross-training (`activity_type` distinguishes them), plus a single `sport_sessions`
model for timed sports (ADR-0013). Live logging screen, resume-an-interrupted-workout,
body metrics, personal records, quick sport logging.

**Edge cases the specification names, each covered by a test:**

| Case | Behaviour |
|---|---|
| Bodyweight | `weight_grams = 0` is stored as 0, not NULL — "bodyweight" differs from "not recorded" |
| Zero weight | Accepted, not rejected as falsy |
| Fractional weight | 2.5 lb is exactly 1134 g; no float anywhere (ADR-0014) |
| Incomplete set | A set with neither reps, weight nor time is refused with a readable message |
| Interrupted workout | The row already exists; `findResumableWorkout` offers to resume after a restart |
| Duplicate taps | Set numbers are computed inside the INSERT, so concurrent logs get 1, 2, 3 |
| Invalid values | Negative, fractional and out-of-range loads, reps, durations and RPE all rejected |

**Personal records are derived, not stored**: `heaviestSetForExercise` skips warm-up and
zero-load sets and excludes unfinished workouts, so correcting a set immediately corrects
the record.

**Verification.** 57 new tests: 36 integration (`tests/integration/fitness.test.ts`,
service -> repository -> real SQLite) and 21 unit (`tests/unit/units.test.ts`).
Total suite now 222 tests across 10 files.

### Fixed

- **ISSUE-004 (critical) — every workout set failed to save.** A validation helper used
  `undefined` for "invalid", but `undefined` also means "field not supplied", so an
  omitted `durationSec` was rejected. Three meanings collapsed into one value; 16 of the
  36 new tests failed before the fix. Replaced with `parseOptionalCount` (ADR-0016).
- **ISSUE-005 — dead code in the seeding routine.** A leftover `driver.run()` with empty
  parameters plus a `void` statement from an earlier draft. Would have executed an INSERT
  with unbound parameters on every launch. Removed.
- `useWorkouts` and `useSportSessions` took an options object that became a new reference
  every render, producing unstable hook dependencies. Now take primitives.
- `TextField` had no `decimal-pad` keyboard type, so fractional weights had no correct
  keyboard on either platform.

### Documentation

ADR-0013 through ADR-0016; `PROJECT_STATUS.md`, `BASELINE.md` and `KNOWN_ISSUES.md`
updated with new totals and ISSUE-004/005.

### Follow-up

Phase 9, books and the PDF reader: `PDFReaderEngine` with per-document capability flags
(ADR-0006), import via the storage adapter, and filesystem-backed PDF storage.




