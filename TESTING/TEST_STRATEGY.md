# TEST STRATEGY

## Current state (verified 2026-01-10)

`npm test` runs 222 tests across 10 suites, all passing.

| Layer | Tool | What it proves |
|---|---|---|
| Pure logic | Jest (`node` project) | money, dates, validation rules |
| Persistence | Jest + **real SQLite** via `node:sqlite` | migrations, constraints, repositories, services |
| Components | `jest-expo` + RNTL | accessibility roles, labels, states, tokens |

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
| Every screen exposes loading / empty / error states | `tests/ui/components.test.tsx` |

## Not yet covered

- Onboarding, reader, focus timer, journal, finance, backup/restore end-to-end flows —
  the features themselves do not exist yet.
- Device-level tests on a real iOS or Android runtime.
- Metro bundle build as part of CI.

## Rule

No release with unresolved critical failures. Every bug fix lands with a regression
test; see `DEVELOPMENT/CHANGELOG.md` for the one instance this session where that
process found a real defect (`ISSUE-001`, the habit-logging race).

