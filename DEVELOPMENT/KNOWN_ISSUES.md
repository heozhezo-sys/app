# Known Issues

Living defect register for LifeOS.

## Rules

Every discovered defect must be recorded until verified fixed.

## Required fields

- ID
- severity
- platform
- feature
- reproduction steps
- expected behavior
- actual behavior
- root cause
- fix
- regression test
- status

## Status values

- discovered
- investigating
- fixing
- verified
- deferred

## Severity

- critical: data loss, security issue, production blocker or crash affecting core workflows
- high: major feature failure or platform-specific blocker
- medium: important defect with workaround
- low: cosmetic or low-impact issue

## Rule

A bug is not resolved because the error disappeared once. It is resolved only after the
root cause is fixed and a regression test or equivalent verification exists.

---

### ISSUE-001 — Habit completion lost under rapid duplicate taps

ID: ISSUE-001
Severity: high
Platform: both
Feature: Habits

**Reproduction.** Tap the habit checkbox twice quickly enough that both taps are
dispatched before either re-read completes. Reachable on both platforms; more likely on
a slow device or with a slow bridge.

**Expected.** Exactly one completion is recorded; the UI shows the habit as done.

**Actual.** `logCompletion` threw `UNIQUE constraint failed: habit_logs.habit_id,
habit_logs.log_date`, so the second tap surfaced an error to the user and the write
failed. The habit could end up in a confusing state depending on which call won.

**Root cause.** Check-then-act: `SELECT` for an existing row, then `INSERT`. Both
concurrent calls saw no row and both attempted the insert. A unique index makes the
duplicate impossible to *store* but does not make the sequence safe — the losing caller
gets an exception instead of a successful no-op.

**Fix.** Replaced with a single atomic
`INSERT ... ON CONFLICT (habit_id, log_date) DO NOTHING`, followed by a read-back so
both callers receive the winning row. Recorded as ADR-0009.

**Regression test.** `tests/integration/habits.test.ts` -> "is idempotent under rapid
duplicate taps", which fires five concurrent `setCompletion` calls and asserts exactly
one row exists.

**Status.** verified

---

### ISSUE-002 — No iOS build or device verification possible on this host

ID: ISSUE-002
Severity: high (process blocker, not a code defect)
Platform: iOS
Feature: all

**Reproduction.** Attempt `npm run ios`, or any `expo run:ios`, on this machine.

**Expected.** An iOS simulator build.

**Actual.** `expo run:ios` is unavailable: the build host is Windows, so there is no
Xcode, no iOS Simulator and no CocoaPods.

**Root cause.** Environment, not code. Documented in `DEVELOPMENT/PROJECT_AUDIT.md` §2.

**Fix.** None available in this environment. iOS-specific behaviour is confined to
`src/platform/*` adapters (none written yet) and the shared code has no
`Platform.OS === 'ios'` branches, so nothing is silently iOS-only.

**Regression test.** Not possible; requires hardware.

**Status.** deferred — needs a macOS host with Xcode before Phases 21–23 can run.

---

### ISSUE-003 — Overdue tasks never appeared

ID: ISSUE-003
Severity: medium
Platform: both
Feature: Goals / tasks

**Reproduction.** Create a task planned for an earlier day, then open Today.

**Expected.** The overdue task appears alongside today's tasks.

**Actual.** The list came back empty apart from tasks planned for exactly the reference
day. Overdue work was invisible, which is the one case where a user most needs to see
it.

**Root cause.** A logic error in one SQL WHERE clause. `plannedDate` was bound to two
independent predicates at once — an equality match (`planned_date = ?`) and an overdue
comparison (`planned_date < ?`) against the same value. Those two conditions are
mutually exclusive, so the query could never match anything. No error was raised; the
list was simply empty, which is why it would have shipped unnoticed.

**Fix.** `overdueOnly` now redefines `plannedDate` as the *reference* day rather than an
equality filter, and the equality clause is skipped entirely when the flag is set. The
distinction is documented on `listTasks`.

**Regression test.** `goals.test.ts` -> "surfaces overdue tasks alongside today, without
duplicates" and "does not treat a finished task as overdue".

**Status.** verified

---

### ISSUE-004 — Every workout set failed to save

ID: ISSUE-004
Severity: critical
Platform: both
Feature: Fitness

**Reproduction.** Log any set through `logSet`.

**Expected.** The set is stored.

**Actual.** Every call threw `ValidationError`, so no set could ever be recorded and
the feature was unusable.

**Root cause.** A validation helper returned `undefined` to mean "invalid", but
`undefined` is also what a caller passes for a field it did not supply. The service
checked `if (durationSec === undefined) throw`, so an omitted `durationSec` — the normal
case for a set of 5 reps at 60 kg — was treated as an invalid duration. Three distinct
meanings were collapsed into one value.

**Fix.** Replaced with `parseOptionalCount`, where omitted (`null`/`undefined`) returns
`null` meaning "not applicable", and only an out-of-range or non-integer value throws.
Each call site names its own field so the message points at the right input.

**Regression test.** The whole `logging sets` block in `tests/integration/fitness.test.ts`,
where 16 of 36 tests failed before the fix.

**Status.** verified

---

### ISSUE-005 — Dead code shipped in the seeding routine

ID: ISSUE-005
Severity: low
Platform: both
Feature: Fitness

**Reproduction.** Read `src/database/seed.ts` immediately after writing it.

**Expected.** Only the statements that do the seeding.

**Actual.** A leftover `driver.run(...)` with an empty parameter list, plus a
`void exercise;` statement, from an earlier draft of the function.

**Root cause.** Editing the function in place rather than rewriting it. The stray call
would have executed an INSERT with unbound parameters on every launch.

**Fix.** Both removed. Lint's `no-unused-vars` would have caught the `void`, but not
the stray call — which is why the file was re-read after being written.

**Status.** verified

