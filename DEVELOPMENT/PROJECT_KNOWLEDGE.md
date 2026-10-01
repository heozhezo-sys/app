# LifeOS Project Knowledge

## Purpose

Living map for the engineering agent. Every statement here is either verified by a
command or explicitly marked as unverified. Do not add a claim here without running
something that proves it.

## Verified starting point (2026-01-10)

Before this work the repository held **69 Markdown files and no code**: no
`package.json`, no source, no tests, no database, no git repository. The documentation
described an application that did not exist. See `DEVELOPMENT/PROJECT_AUDIT.md`.

## Product scope

LifeOS is a cross-platform personal improvement application for iOS and Android.
Domains: habits, goals, productivity, fitness, sports, health, books/PDF reading,
journal, finance, analytics, notifications and personal planning.

## Core architectural constraints

- Local-first and offline-first. No core feature may require the network.
- SQLite is the persistent source of truth, reached only through `SqlDriver`.
- Filesystem storage for PDFs and large media; the database holds metadata only.
- Schema changes require migrations; released migrations are immutable.
- Platform adapters for native APIs; shared logic stays platform-neutral.
- Soft delete for user-visible deletes; history is preserved.
- Money as integer minor units; calendar days as local `YYYY-MM-DD`.

## Actual package versions

Confirmed on disk, not estimated:

`expo ~57.0.26`, `react-native 0.86.3`, `react 19.2.3`, `expo-router ~57.0.24`,
`expo-sqlite ~57.0.3`, `typescript ~5.9.2`, `jest ^30.5.2`, `jest-expo ^57.0.5`.
Full list in `TECH_STACK.md` and `package.json`.

## Actual database schema

12 migrations, 31 tables. The authoritative source is `src/database/migrations/`;
`DATA/DATABASE_SCHEMA.md` is only a map. Table-by-table listing is in that file.

## Actual navigation

```
app/
  _layout.tsx            root: bootstrap, theme, error boundary, Stack
  index.tsx              entry gate (onboarding -> Today)
  onboarding.tsx         first run
  (tabs)/_layout.tsx     tab bar
  (tabs)/index.tsx       Today dashboard (habits + tasks)
  (tabs)/habits.tsx      habits management
  (tabs)/goals.tsx       goals overview
  (tabs)/fitness.tsx     workouts, body metrics, quick sport log
  manage.tsx             archive / restore / delete
  habit/[id].tsx         habit detail and history
  goal/[id].tsx          goal detail: milestones, tasks, lifecycle
  workout/[id].tsx       live set logging
```

The specification describes five tabs. Four exist (Today, Habits, Goals, Fitness) and
the tab bar shows only what is implemented (ADR-0010).

## Reference data

`src/data/exerciseCatalog.ts` (43 exercises) and `src/data/sportsCatalog.ts` (47 sports)
are seeded after migrations by `src/database/seed.ts` using `ON CONFLICT DO NOTHING`
(ADR-0015). Seeding is idempotent and safe to interrupt.

## Actual test commands

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | clean, zero warnings |
| `npm test` | 222 tests, 10 suites, all passing |

Migrations and repositories are tested against real SQLite via Node 22 `node:sqlite`.

## Unresolved risks

1. **iOS cannot be verified on this host.** Windows has no Xcode. Phases 21-23 of the
   specification are blocked until a macOS host is available. See `KNOWN_ISSUES.md`
   ISSUE-002.
2. **Android runtime is unverified.** The SDK is installed but `adb` is not on `PATH`
   and no emulator has been run.
3. **Most features do not exist.** Habits, goals and fitness are implemented end to end;
   books are implemented below the UI. The full ledger is
   `DEVELOPMENT/PROJECT_STATUS.md`.
4. **Large-dataset performance is untested.** Pagination and virtualised lists are not
   implemented. See `EDGE_CASES.md` EDGE-0009.
5. **The PDF engine reports what it cannot do.** `StructurePdfEngine` parses structure
   but does not rasterise or inflate streams, so `rendering` and `textSearch` are
   `false`. No rasterising engine has been selected; ADR-0006 records the decision and
   its open risks. Do not "fix" this by faking the flags.
6. **Books work end to end, but page images do not.** Import, library, reader navigation,
   progress, bookmarks and highlights are implemented and wired to the UI. The reader
   states plainly that page images and text search are unavailable rather than faking
   them. A rasterising engine is still unselected; ADR-0006 records the open risks.
7. **The device storage adapter is unverified at runtime.** `ExpoStorageAdapter` is
   tested against a fake `expo-file-system` that mirrors the SDK 57 API, but has never
   run on a device. Its error classification depends on native error message text.
8. **Settings normalisation lacks unit coverage.** See EDGE-0006.
9. **`isoWeekKey` had a latent off-by-one, now fixed.** It asserted only key *shape* in
   tests, which hid a bug that filed every Thursday and later day one week too high. If you
   add a period-key function, assert the exact value, not a regex. See EDGE-0020.
10. **Recovery ratings have no table.** `FEATURES/HEALTH.md` specifies energy, soreness,
   recovery and mood ratings, but migration 007 has no such table. It needs migration 013
   before it can be built. Do not "just add a column" — a migration is the mechanism here.
11. **The journal is unencrypted at rest.** It sits in the app sandbox with every other
    record. The app lock is a UI gate backed by SecureStore, and nothing claims otherwise.
    `tests/integration/journal.test.ts` asserts structurally that no networking library is
    reachable from the journal module graph — if you add sync, that test fails by design
    and the change needs to be deliberate.

## Health subsystem notes for future sessions

- `sleep_date` is the **wake-up date**. A bedtime later than the wake time belongs to the
  previous evening. This is not cosmetic: it is what makes `CHECK (wake_time >= bedtime)`
  satisfiable for a normal night.
- `nutrition_entries` snapshots calories and macros. Never "optimise" it into a foreign key
  to `foods` — that is precisely how editing a food would silently rewrite a user's history.
- **Never compare parsed objects with `>` or `<`.** It stringifies both to
  `"[object Object]"` and is always false. `resolveSleepWindow` shipped this bug and every
  cross-midnight night silently became a same-day one until a test caught it.
- Hydration progress is deliberately capped at 100%, and the sleep consistency figure
  returns `null` below three nights. Both are about not implying something the data cannot
  support. `FEATURES/HEALTH.md` forbids medical claims.
- Volume parsing is strict on purpose. `"2 cups"` is rejected rather than assumed to be
  500 ml; an invented conversion produces advice built on a fiction.

## Journal subsystem notes for future sessions

- **`SELECT *` does not return SQLite's implicit `rowid`.** Search joins on it, so it is
  selected explicitly. This cost a silent "search always returns nothing" bug that passed
  typecheck and lint, and was only visible when the FTS query answered correctly while the
  search returned empty.
- Tags are stored as a **JSON array**, not a delimited string. A delimiter is data: users
  type commas and quotes. `parseTags` degrades to a comma split on malformed input rather
  than failing, because losing the user's writing to an odd tag string is the worse outcome.
- FTS5 availability is recorded in `search_capabilities` by migration 012. `journal/search`
  reads it, and also falls back if an FTS5 query is rejected. **Test both paths** — the
  fallback is what Android builds without FTS5 will actually use.
- The privacy test in `tests/integration/journal.test.ts` is load-bearing, not decorative.
  It is expected to fail if sync is ever added, and that failure is the point.

## Timer and clock notes for future sessions

- Focus timers store a wall-clock deadline and recompute elapsed time from the clock
  (ADR-0005). The one-second interval is only a *rendering* cadence; never derive state
  from tick counts.
- The focus service takes an injectable clock (`setClock`). Tests move time by hand
  instead of waiting, which is the only practical way to cover process-kill and
  reopen-late cases. Production never calls `setClock`.
- A session left `active` by a process kill blocks every future timer through the
  single-active-session partial UNIQUE index. `recoverStaleSession` on launch is what
  prevents the app from deadlocking itself; do not remove it.
- Clamp both ends of a time window to the planned length. A backwards device clock makes
  `endsAt - now` *larger* than the window, so clamping only elapsed time is not enough.
- Prefer deriving UI state over syncing it through an effect. `react-hooks/set-state-in-
  effect` is enabled and correctly flags "copy X into state when Y changes" — in these
  cases the derived value is simpler and has no stale frame.

## PDF subsystem notes for future sessions

- The parser **scans for `N G obj` markers rather than following the xref table**. This
  is deliberate: real PDFs have broken xrefs far more often than broken page trees.
  Do not "optimise" it into a strict xref reader without a fallback.
- The page-tree walk is cycle-guarded and depth-limited. Malformed files that point
  `/Kids` at their own parent are a real occurrence, not a hypothetical.
- Four parser bugs cost most of the debugging time in this phase and are the kind that
  pass a casual reading: a loop that never checked the marker it was matching; a
  dictionary parser that started on the *second* `<` of `<<` and so returned an empty
  dictionary for every object; a reference matcher that looked for `R` before consuming
  the generation token; and a literal-string parser that included its own opening
  paren. All four produced plausible-looking, silently wrong results rather than errors.
- Import writes `books/<name>.pdf.part`, validates the stored bytes, atomically renames,
  and only then does the caller insert the row. `booksService.commitImport` is the single
  place that writes the row, and it removes the file again if the insert fails. Reversing
  that order reintroduces a library entry pointing at a missing file. See ADR-0017.
- The `StorageAdapter` interface exists so crash, full-disk and externally-deleted-file
  cases are deterministic in tests. They are effectively impossible to reproduce on
  demand on a device, so keep those tests on the in-memory adapter.
- `expo-file-system` SDK 57 has no `idempotent` option on `RelocationOptions` or
  `FileCreateOptions` — only `overwrite`. It exists only on `DirectoryCreateOptions`.
- URI joining must not collapse `file:///documents` to `file://documents`. A naive
  `replace(/\/{2,}/g, '/')` does exactly that and produces a wrong path that still
  superficially works.

## Verification rule

No statement in this file may be treated as verified unless it names the command that
proved it. When implementation changes, update this file, `BASELINE.md`,
`PROJECT_STATUS.md`, `DECISIONS.md` and `CHANGELOG.md` in the same change.
