# TEST STRATEGY

## Current state (verified 2026-10-01)

`npm test` runs **1017 tests across 36 suites**, all passing. `npm run typecheck` and
`npm run lint` are both clean.

| Layer | Tool | What it proves |
|---|---|---|
| Pure logic | Jest (`node` project) | money, exchange rates, dates, validation rules, state machines |
| Persistence | Jest + **real SQLite** via `node:sqlite` | migrations, constraints, repositories, services |
| Components | `jest-expo` + RNTL | accessibility roles, labels, states, tokens |
| Structural contracts | Jest, asserting over source | rules that a comment decays and a test does not |

## The central idea

Migration and repository tests execute the **same SQL strings** that ship to the
device, against a real SQLite engine (`node:sqlite`, built into Node 22). There is no
SQLite mock. A typo in a migration fails `npm test` rather than a user's phone.

## Coverage of critical flows

| Flow | Where |
|---|---|
| Create / edit / archive / restore / soft-delete a habit | `tests/integration/habits.test.ts` |
| Complete and undo, including rapid duplicate taps | same |
| Streak derivation and recomputation from history | same |
| Goal status transitions, including illegal ones | `tests/integration/goals.test.ts` |
| Every goal/milestone/task state pair classified | `tests/unit/stateTransitions.test.ts` |
| Goal progress derived from milestones | `tests/integration/goals.test.ts` |
| Overdue task handling | same |
| Bodyweight, zero and fractional weights | `tests/integration/fitness.test.ts` |
| Interrupted workout recovery | same |
| Reference-data seeding idempotency | same |
| Integer-gram arithmetic for plate weights | `tests/unit/units.test.ts` |
| Per-sport metric schema filtering | `tests/integration/fitness.test.ts` |
| Upgrade from an earlier schema, preserving rows | `tests/integration/migrations.test.ts` |
| Interrupted / failing migration leaves data untouched | same |
| Refusing to touch a newer schema | same |
| Duplicate completion impossible at the storage layer | `tests/integration/schema.test.ts` |
| Money cannot drift | `tests/unit/money.test.ts` |
| Local-calendar correctness across DST and month ends | `tests/unit/dates.test.ts` |
| PDF structure parsing, including damaged xref tables | `tests/integration/pdf.test.ts` |
| Interrupted import leaves an orphan, never a truncated file | same |
| Journal search on FTS5 and on the `LIKE` fallback | `tests/integration/journal.test.ts` |
| Journal export: format rendering, body-omitted-by-default, atomic write | `tests/integration/journalExport.test.ts` |
| The journal lock does not persist its unlocked state | same |
| Focus timer survives a backwards device clock | `tests/integration/focus.test.ts` |
| Recovery ratings: omitted ratings cleared, report derived on read | `tests/integration/recovery.test.ts` |
| Recurrence cadence expansion and clamping | `tests/integration/recurrence.test.ts` |
| Reminders: permission, scheduling, cancellation, rehydration | `tests/integration/notifications.test.ts` |
| Analytics periods are local, never UTC-derived | `tests/integration/analytics.test.ts` |
| Achievement evaluation is idempotent and re-runnable | `tests/integration/achievements.test.ts` |
| Calendar projection covers every domain | `tests/integration/calendar.test.ts` |
| Backup round trip is byte-identical and restores exactly | `tests/integration/backup.test.ts` |
| Restore takes a safety copy and undo is itself undoable | same |
| A malformed or future-schema backup is refused before anything is written | same |
| Exchange-rate parsing without float drift | `tests/unit/rates.test.ts` |
| Conversion across differing minor-unit exponents, rounded half away from zero | same |
| A corrupt stored rate map fails closed | `tests/integration/exchangeRates.test.ts` |
| A converted total names the currencies it cannot convert | same |
| Transfer pairing and rollback ordering against real SQLite | `tests/integration/finance.test.ts` |
| Every screen exposes loading / empty / error states | `tests/ui/components.test.tsx` |
| No screen contains a network call | `tests/ui/secondaryModules.test.tsx` |
| No screen branches on `Platform.OS` | same |
| Selection state is exposed, not conveyed by colour | same |
| Health and analytics copy contains no medical or judgemental claim | same |
| Every hub destination is registered in the root layout | same |

## Not yet covered

- **Device-level tests on a real iOS or Android runtime.** This is the largest gap and it
  is not closable in this environment: iOS needs macOS with Xcode (ISSUE-002) and no
  Android emulator is provisioned.
- Metro bundle build as part of CI.
- Snapshot testing of rendered screens; the UI suites assert accessibility contracts and
  structural invariants rather than pixel output.
- The PDF reader's page rendering, text search, zoom and gestures, because the current
  engine reports those capabilities as unsupported (ADR-0006).

## Rule

No release with unresolved critical failures. Every bug fix lands with a regression
test. Two instances where that process found a real defect this session:

- **ISSUE-001** — the habit-logging race.
- **ISSUE-006** — `undoLastRestore` reading its snapshot after clearing the slot, so the
  rollback path was dead and reported itself as "nothing to undo".

Both were silent failures in paths that had no test, which is the argument for the rule
rather than a justification for it.
