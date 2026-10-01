# Architecture and Engineering Decisions

Recorded so future AI sessions do not repeat the analysis. A decision that only lives
in a conversation is lost.

---

### ADR-0001 — SQLite behind a driver interface, tested with real SQLite

Date: 2026-01-10
Status: accepted

**Context.** The specification demands tested migrations, but `expo-sqlite` cannot load
outside a device runtime. Mocking SQLite would mean the tested SQL is not the shipped
SQL.

**Decision.** All SQL goes through the `SqlDriver` interface. Production uses
`ExpoSqlDriver`; tests use `NodeSqliteDriver`, implemented over Node 22's built-in
`node:sqlite`. Migrations are ordinary modules consumed by both.

**Consequences.** The identical SQL strings are executed on every `npm test`. A broken
migration fails CI rather than a user's device. Cost: the driver interface must stay
small, and a SQL feature used by only one platform could be hard to test.

---

### ADR-0002 — Centralised design tokens, no raw values in components

Date: 2026-01-10
Status: accepted

**Context.** The specification says "never scatter arbitrary values".

**Decision.** Colours, type scale, spacing, radii and motion live in `src/theme/`.
Components read them through `useTheme()`. Series colours are referenced by index, so
a habit stores `colorIndex: 3`, never a hex string.

**Consequences.** Dark mode and theme changes cost nothing extra. A component cannot
hard-code a colour. Tests assert that tokens actually resolve.

---

### ADR-0003 — Money as integer minor units

Date: 2026-01-10
Status: accepted

**Context.** "Never use unsafe floating-point calculations for money." In binary
floating point `0.1 + 0.2 !== 0.3`, and `parseFloat('19.99') * 100` is `1998.9999...`.

**Decision.** Amounts are INTEGER minor units plus an ISO-4217 code.
`parseAmountToMinor` parses the decimal *string* digit by digit and never routes
through `parseFloat`. Currencies with 0- and 3-decimal minor units are supported.
Arithmetic is exact integer arithmetic that throws on overflow rather than returning a
wrong number.

**Consequences.** No ledger can drift. Costs: every amount needs an explicit scale, and
`formatMinor` needs a currency-aware fallback for Hermes builds without full ICU.

---

### ADR-0004 — No TanStack Query; a local change-notification bus instead

Date: 2026-01-10
Status: accepted

**Context.** `TECH_STACK.md` originally listed TanStack Query "for optional remote
data". LifeOS has no remote service and is offline-only for core features.

**Decision.** Do not install TanStack Query. Repositories call `notify(channel)` after a
write; `useAsyncResource` subscribes and re-reads from SQLite. Zustand is used only for
app-wide settings.

**Consequences.** No unused dependency and no cache-invalidation layer for a network
that does not exist. If sync is ever added, the notification bus is already the
invalidation mechanism it needs. This is a deliberate deviation from the original tech
stack.

---

### ADR-0005 — Wall-clock deadlines for timers

Date: 2026-01-10
Status: accepted

**Context.** "Timers must survive backgrounding, screen lock, app suspension, app
reopening." An in-memory tick counter fails all four.

**Decision.** `focus_sessions` stores `started_at` and `ends_at` as absolute epoch
milliseconds; elapsed time is always recomputed from the clock. A partial UNIQUE index
allows only one `active` session.

---

### ADR-0006 — PDF engine behind `PDFReaderEngine` with capability flags

Date: 2026-01-10
Status: accepted (amended 2026-01-10)

**Context.** Continuous scroll, search, highlights and outline support depend on the
PDF's own structure, not on the app. The specification forbids faking capabilities.

**Decision.** `PDFReaderEngine` returns a capability descriptor per document; the UI
renders an explicit "unsupported" state instead of a control that silently does nothing.
No third-party engine has been selected yet.

**Amendment (Phase 9).** The interface is now implemented, together with a real parser
(`src/pdf/engine/pdfStructure.ts`, `documentReader.ts`) that reads page count, page
geometry, the info dictionary, encryption state and the table of contents from the
bytes. `StructurePdfEngine` is the shipped implementation behind that interface.

It reports `rendering: false` and `textSearch: false` **honestly**, because it does not
rasterise and does not decompress Flate streams. The reader shows an explicit
explanation for those features rather than an empty page frame. A rasterising engine is
a single constructor change; nothing else moves.

Two consequences worth recording:

- The parser **scans for `N G obj` markers instead of following the xref table.** Real
  PDFs have broken or subtly wrong cross-reference tables far more often than they have
  broken page trees, and a user who just picked a book should not be shown an error
  because a writer mislabelled a byte offset.
- The page-tree walk is cycle-guarded and depth-limited. Malformed files can point
  `/Kids` back at their own parent, and an unguarded walk would hang the app on a file
  the user is trying to read.

**Consequences.** Reader behaviour stays honest across heterogeneous documents, and
every capability flag is measured rather than assumed. Open risk remains: bundle impact
and licensing of a rasterising engine are still unevaluated, and no engine has been
validated on a real device.

---

### ADR-0007 — Migrations are transactional, forward-only and non-destructive

Date: 2026-01-10
Status: accepted

**Context.** "Never allow a migration failure to silently erase user data."

**Decision.** Each migration runs in one transaction and `PRAGMA user_version` advances
only after a successful commit. A failure rolls back that migration alone and leaves
earlier ones applied. A database newer than the binary is refused with a clear error
rather than downgraded. `Migration.allowDataLoss` exists only so a destructive change
must be an explicit, reviewable act — no migration sets it, and a test asserts none
does. A pre-migration hook runs before anything is touched, so a backup can be taken
first.

**Consequences.** Interrupted and failing upgrades are safe. Verified by
`tests/integration/migrations.test.ts`.

---

### ADR-0008 — Capability-gated FTS5

Date: 2026-01-10
Status: accepted

**Context.** Some Android system SQLite builds omit FTS5, and a migration must not fail
because an optional accelerator is missing.

**Decision.** The runner probes FTS5 inside a savepoint that is always rolled back.
Migration 012's FTS statements run only if the probe succeeds, and the outcome is
recorded in `search_capabilities`. Search falls back to `LIKE` when unavailable.

**Consequences.** Migration never fails on a device lacking FTS5. Search is slower
there, but correct.

---

### ADR-0009 — Atomic writes for user-initiated "mark done"

Date: 2026-01-10
Status: accepted

**Context.** `ISSUE-001`: `logCompletion` originally did SELECT-then-INSERT. Under two
concurrent taps both observe "no row" and both insert; one fails with a UNIQUE
violation. A unique index alone does not make a check-then-act sequence safe.

**Decision.** The insert is a single
`INSERT ... ON CONFLICT (habit_id, log_date) DO NOTHING`, followed by a read-back, so
both callers converge on one row.

**Consequences.** Double taps are safe. Regression test:
`habits.test.ts` -> "is idempotent under rapid duplicate taps".

---

### ADR-00010 — Only implemented destinations appear in navigation

Date: 2026-01-10
Status: accepted

**Context.** The specification's tab bar is Today / Habits / Fitness / Library / Goals.
Only Today and Habits exist.

**Decision.** The tab bar shows only implemented screens. An entry leading to a missing
or stubbed screen would be exactly the placeholder behaviour the specification bans.

**Consequences.** A narrower tab bar than the specification describes, honestly. Tabs
are added as their vertical slice completes.

---

### ADR-0011 — Status changes go through a pure state machine

Date: 2026-01-10
Status: accepted

**Context.** The specification requires: "Do not allow invalid state transitions." That
rule is easy to state and easy to lose — a status check scattered across a service, a
screen and a background job will drift, and the database CHECK constraint can only
enumerate *valid* states, never *legal moves between* them.

**Decision.** `src/services/stateTransitions.ts` holds the only transition tables, as
plain data with no database, React or I/O. Services call `assert*Transition`, which
throws `InvalidTransitionError` naming the allowed targets. The goal detail screen
renders buttons directly from the table, so the UI cannot offer a move the domain would
reject.

**Key rule.** A status representing finished work (`completed`, `cancelled`) is only
reversible through `archived`. Silently reopening a cancelled goal would erase the fact
that it was cancelled.

**Consequences.** Adding a status without defining its transitions fails the exhaustive
test immediately. Cost: one more layer to keep in sync, and an extra indirection when
reading status changes.

---

### ADR-0012 — Goal progress is derived from milestones, not maintained by hand

Date: 2026-01-10
Status: accepted

**Context.** `FEATURES/GOALS.md` says "Progress is derived from completed milestones
and recorded metrics where possible." Storing a user-typed percentage as well would
create two sources of truth that can disagree.

**Decision.** `goals.progress_pct` is a *cache* of a rule, recomputed by
`recomputeGoalProgress` after every milestone insert, status change or delete. A manual
percentage is only accepted for a goal with no milestones, and is refused with an
explanatory error once milestones exist rather than being silently overwritten.

**Consequences.** Progress can never drift from the milestones. Completion forces it to
100. The cost is that the UI must explain why manual progress is refused, rather than
just disabling a field.

---

### ADR-0013 — One activity architecture, not one system per sport

Date: 2026-01-10
Status: accepted

**Context.** The specification lists gym, home workout, running, walking, cycling,
swimming, 47 more sports, mobility, stretching and recovery — and says explicitly:
"Create reusable activity architecture. Do not duplicate entire systems for every sport."

**Decision.** Two models cover everything:

- `workouts` + `workout_sets` for anything built from sets (gym, home, mobility,
  stretching, cross-training). `activity_type` distinguishes them; the mechanics do not
  differ.
- `sport_sessions` for anything with a start, a duration and metrics.

Navigation matches: one Fitness tab starts any activity type, and there is no
"Running app" or "Stretching app".

**Consequences.** Adding a sport is a catalogue row, not a feature. What a sport can
record is driven by its metric schema, so a new sport needs no migration. The cost is
that genuinely sport-specific concepts (a cricket over, a swim stroke) must be
expressible as configured metrics rather than bespoke columns.

---

### ADR-0014 — Weights are integer grams

Date: 2026-01-10
Status: accepted

**Context.** The same reasoning as money (ADR-0003), plus a domain-specific problem: bar
plates come in fractional sizes. A 2.5 lb change plate is 1133.9809... grams. Stored in a
float column, the app would display a load that does not exist on any gym floor.

**Decision.** Every load is INTEGER grams. 2.5 lb is exactly 1134 g; a 1.25 kg plate is
exactly 1250 g. RPE is an integer scaled by 10, so 7.5 is 75. Conversion from the
user's display unit happens once, at the edge, and never in storage or analytics.

**Bodyweight is a real zero.** `weight_grams = 0` is stored as 0, not NULL, because
"bodyweight" and "did not record a weight" are different facts. Personal records skip
zero-load sets for the same reason.

**Consequences.** No plate ever drifts. Verified by `tests/unit/units.test.ts`.

---

### ADR-0015 — Reference data is seeded at runtime, not in a migration

Date: 2026-01-10
Status: accepted

**Context.** The exercise and sport catalogues are data, not schema, and they grow with
releases. ADR-0007 makes a released migration immutable, so adding an exercise by editing
migration 004 would break the immutability rule.

**Decision.** Catalogues live in typed TypeScript modules (`src/data/`) and are inserted
by `seedReferenceData` after migrations run, using `ON CONFLICT DO NOTHING`. Never
`INSERT OR REPLACE`, which would discard user edits and reset `is_archived`.

**Consequences.** Every catalogue entry is type-checked and reviewable in isolation;
adding an exercise is a data change, not a migration. Cost: seeding runs on every launch
(cheap — it is all conflict-guarded inserts) and the catalogue cannot be versioned by
schema version alone.

---

### ADR-0016 — `undefined` never means "invalid"

Date: 2026-01-10
Status: accepted

**Context.** ISSUE-004: a validation helper returned `undefined` for "invalid", which
collided with `undefined` meaning "field not supplied". Every workout set failed to save.

**Decision.** Omitted input is `null` and means "not applicable". Only a value that is
present and out of range throws, and every call site names its field so the message
points at the right input.

**Consequences.** Partial input works as intended (reps without weight, or a timed set
with neither). This is recorded as an ADR because the bug class — conflating "absent"
with "invalid" — is easy to reintroduce and is invisible to the type checker.

---

### ADR-0017 — The file lands before the database row

Date: 2026-01-10
Status: accepted

**Context.** A PDF import copies bytes into app storage and then creates a library entry.
A phone can be killed at any point: during the copy, between the copy and the rename, or
between the rename and the insert. Mobile operating systems also kill apps under memory
pressure without warning, and the user is usually mid-import when it happens.

**Decision.** Import writes to `books/<name>.pdf.part`, validates the stored bytes, then
**atomically renames** to `books/<name>.pdf`, and only then does the caller insert the
database row. Orphans of the `.part` shape are swept by `cleanupInterruptedImports` on
the next launch.

**Consequences.** The failure mode is chosen, not merely reduced: a crash can leave at
worst an unusable file that is automatically removed, and **never** a library entry
pointing at a file that does not exist. The reverse order would produce exactly the
state the specification calls out as unacceptable. Book deletion uses the mirror-image
order — hide the row first, then delete the file — so a crash there leaves an orphaned
file rather than a broken entry.

**Testing consequence.** This ordering is the reason the storage layer is an interface.
Crash, full-disk and externally-deleted-file cases are deterministic against an
in-memory adapter and effectively impossible to reproduce on demand on a real device.

**Enforcement.** `booksService.commitImport` is the only function in the codebase that
creates a `books` row, and it deletes the stored file if the insert throws. A screen
cannot bypass the ordering because it has no other way to insert. This is why the
two-phase API exists rather than a single `importPdf` that also writes the row.

---

### ADR-0018 — Native filesystem errors are classified by message, conservatively

Date: 2026-01-10
Status: accepted

**Context.** `expo-file-system` surfaces native failures as plain `Error` objects whose
messages differ between iOS and Android and between OS versions. The app needs to tell
"not enough space" apart from "the user moved the file", because the user-facing response
is completely different.

**Decision.** `classify` maps messages onto `StorageError` codes by substring, ordered
most-specific first. Anything unrecognised becomes `IO` with the original message
preserved as `cause`. A `NOT_FOUND` result is also checked structurally first, by asking
whether the file exists, rather than relying on the message at all.

**Consequences.** The two codes that matter most — `NOT_FOUND` and `NOT_ENOUGH_SPACE` —
are covered by tests and degrade to a generic error rather than a wrong specific one. The
cost is that an unexpected new OS message would surface as "Filesystem error" instead of
a precise explanation. That is the preferred failure direction: a vague but honest error
is better than a confident "out of space" that sends the user to delete the wrong thing.

**This is a known weakness, not a solved problem.** It is recorded so a future session
does not mistake it for a robust classification scheme, and so that if the SDK ever
exposes typed error codes, the work here is replaced rather than extended.


