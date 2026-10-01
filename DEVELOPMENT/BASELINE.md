# BASELINE

Established at the first real implementation run. Every number below was produced by
running the command, not by estimation.

> **Current state (2026-10-01): 1017 tests across 36 suites; typecheck and lint clean;
> schema v15 with 15 migrations and 44 tables.** The tables below record the *starting*
> baseline and are kept as history, per the knowledge protocol's rule against erasing
> earlier findings. For what is true now, read `DEVELOPMENT/PROJECT_STATUS.md`.
>
> The environment has also changed: the host is now **Linux** (Node 22.23.2) rather than
> Windows, and no Android SDK or emulator is provisioned. The iOS blocker is unchanged —
> neither host has Xcode — so ISSUE-002 still stands.

## Environment (verified)

| Tool | Version | Command |
|---|---|---|
| Node.js | v22.23.0 | `node --version` |
| npm | 12.0.1 | `npm --version` |
| git | 2.53.0.windows.2 | `git --version` |
| Build host | Windows | — |
| Android SDK | present at `C:\Users\Razhil\AppData\Local\Android\Sdk` | filesystem check |
| Android Studio | present | filesystem check |
| Xcode / iOS toolchain | **absent** | — |

## Stack actually installed (verified from `package.json` + lockfile)

| Package | Resolved version |
|---|---|
| expo | ~57.0.26 |
| react | 19.2.3 |
| react-native | 0.86.3 |
| expo-router | ~57.0.24 |
| expo-sqlite | ~57.0.3 |
| react-native-reanimated | 4.5.1 |
| react-native-worklets | 0.10.1 |
| zustand | ^5.0.15 |
| typescript | ~5.9.2 |
| jest / jest-expo | ^30.5.2 / ^57.0.5 |
| @testing-library/react-native | ^14.0.1 |
| eslint / eslint-config-expo | ^9.39.0 / ^57.0.2 |

## Starting state

There was no baseline to record, because at the start of this work the repository
contained **only Markdown** — no `package.json`, no source, no tests, no database and
no git repository. See `PROJECT_AUDIT.md`.

There were therefore **zero pre-existing failures**. Every failure encountered since
was introduced by the work and has been resolved; they are listed in `CHANGELOG.md`.

## Verification gates (current)

| Gate | Command | Result (at baseline) | Result (2026-10-01) |
|---|---|---|---|
| Types | `npm run typecheck` | **PASS** (exit 0) | **PASS** (exit 0) |
| Tests | `npm test` | **PASS** — 222 tests, 10 suites | **PASS** — 1017 tests, 36 suites |
| Lint | `npm run lint` | see `CHANGELOG.md` for final state | **PASS** — zero warnings |

### What the test suite actually covers

| Suite | Tests | What it proves |
|---|---|---|
| `tests/unit/money.test.ts` | 20 | No floating-point money; exact integer arithmetic; the classic float traps (`19.99`, `1.15`, `8.29`, `0.1+0.2`); zero- and three-decimal currencies; malformed input rejected |
| `tests/unit/dates.test.ts` | 16 | Local-calendar correctness; leap years; DST spans; week/ISO-week derivation; impossible dates rejected |
| `tests/integration/migrations.test.ts` | 12 | All 12 migrations apply to real SQLite; versions gap-free; no destructive SQL; idempotent re-run; partial upgrade; future schema refused; a failing migration rolls back and leaves `user_version` untouched |
| `tests/integration/schema.test.ts` | 20 | Foreign keys actually enforced; CASCADE/SET NULL/RESTRICT behave as designed; duplicate habit completion impossible; one active focus timer; CHECK constraints reject bad money, RPE, pages and completion times |
| `tests/integration/habits.test.ts` | 19 | Full habit slice through service → repository → real SQLite: create/validate/toggle/undo/archive/restore/soft-delete; streak derivation and recomputation |
| `tests/integration/goals.test.ts` | 30 | Goals, milestones and tasks end to end: legal and illegal transitions, derived progress, cross-goal milestone rejection, overdue handling, soft-delete history |
| `tests/unit/units.test.ts` | 21 | Integer grams represent fractional plate weights exactly (2.5 lb = 1134 g, 1.25 kg = 1250 g); RPE scaled integers; distance and duration conversion |
| `tests/unit/stateTransitions.test.ts` | 19 | Every goal/milestone/task state pair is classified, so an undeclared transition is provably rejected; terminal states cannot be silently reopened |
| `tests/integration/fitness.test.ts` | 36 | Gym/home/mobility/sport slices end to end: seeding idempotency, bodyweight as a real zero, fractional plate weights, incomplete sets, interrupted-workout recovery, distinct set numbers under concurrency, derived personal records, configurable sport metrics |
| `tests/ui/components.test.tsx` | 29 | Accessibility roles, labels, hints and states; 48pt touch targets; light/dark token application; non-colour-only state indication; overdue and bodyweight stated in words |

## Not verified on this host

- **iOS**: cannot be built or run. No Xcode on Windows. Nothing in this repository
  claims iOS runtime verification.
- **Android runtime**: the SDK is installed but `adb` is not on `PATH` and no emulator
  was started, so no on-device Android verification has been performed either.
- **Bundle/Metro build**: not yet executed.
