# LifeOS Edge Cases

Living catalogue of scenarios that can break user workflows.

## Rule

Whenever a new edge case is discovered, add it here and test it before considering the
affected feature complete.

## Entries


## Required coverage

- rapid duplicate taps
- app termination during writes
- app background/foreground transitions
- offline operation
- intermittent connectivity
- timezone changes
- date boundary changes
- permission denial
- permission revocation
- low device storage
- corrupted local data
- missing files
- deleted PDFs
- very large PDFs
- unsupported PDFs
- failed migrations
- interrupted imports
- duplicate records
- large datasets
- large accessibility font sizes
- dark mode
- iOS safe areas
- Android back navigation
- upgrade from older database versions

## Entry format

### EDGE-XXXX

Scenario:

Affected feature:

Expected behavior:

Actual behavior:

Resolution:

Regression verification:

Status:

### EDGE-0001

Scenario: Rapid duplicate taps on a habit completion.
Affected feature: Habits
Expected behavior: Exactly one completion is recorded; the UI settles on "done".
Actual behavior: **Was** a UNIQUE constraint violation surfacing an error. Fixed by ADR-0009.
Resolution: Atomic `INSERT ... ON CONFLICT DO NOTHING` plus read-back.
Regression verification: `habits.test.ts` -> "is idempotent under rapid duplicate taps".
Status: verified (see `KNOWN_ISSUES.md` ISSUE-001)

### EDGE-0002

Scenario: User changes timezone or the device clock.
Affected feature: Habits, hydration, sleep, budgets
Expected behavior: A completion already recorded keeps the calendar day it was recorded on.
Actual behavior: Handled by construction. `src/utils/dates.ts` works exclusively in local
calendar terms and never calls `toISOString()`; a stored `log_date` is never recomputed
from its timestamp.
Resolution: Local-date helpers with a noon anchor to survive DST.
Regression verification: `dates.test.ts` -> "formats a late-evening local time as the
same calendar day", and the DST range test.
Status: verified at the logic layer; not verified on a device.

### EDGE-0003

Scenario: Date boundary changes and leap years.
Affected feature: Streaks, budgets, weekly reviews
Expected behavior: Day arithmetic stays exact across month ends, leap days and DST.
Actual behavior: Handled. `addDays` constructs the target date from its parts rather than
adding milliseconds, so a 23h or 25h DST day cannot shift the result.
Resolution: Calendar-part arithmetic; UTC-midday anchor only for pure difference math.
Regression verification: `dates.test.ts` leap-day and DST tests.
Status: verified

### EDGE-0004

Scenario: Interrupted or invalid migration during an app update.
Affected feature: All data
Expected behavior: The database is left exactly as it was; the app does not lose data.
Actual behavior: Handled. Each migration is transactional, `user_version` advances only
after commit, and a failing migration rolls back alone.
Resolution: ADR-0007.
Regression verification: `migrations.test.ts` -> "rolls a failing migration back and leaves
the version unchanged" and "rolls back only the failing migration, keeping earlier ones
applied".
Status: verified

### EDGE-0005

Scenario: App is downgraded to an older build, or data comes from a newer build.
Affected feature: All data
Expected behavior: The app refuses to touch the database rather than corrupting it.
Actual behavior: Handled. A `user_version` newer than the binary raises `FUTURE_SCHEMA`
and the connection is never opened for writing.
Resolution: ADR-0007.
Regression verification: `migrations.test.ts` -> "refuses a schema newer than the binary
without touching it".
Status: verified

### EDGE-0006

Scenario: Corrupt settings JSON on disk.
Affected feature: Settings, theme, all screens
Expected behavior: The app still starts with default settings.
Actual behavior: Handled. `normaliseSettings` merges over defaults and type-checks each
field; unreadable JSON falls back to defaults rather than throwing during launch.
Resolution: Defensive normalisation at the read boundary.
Regression verification: Unit coverage is pending; add with the settings feature tests.
Status: implemented, test gap noted

### EDGE-0007

Scenario: A device SQLite build without FTS5.
Affected feature: Search
Expected behavior: Search still works, using a slower fallback.
Actual behavior: Handled. FTS statements are capability-gated and the probe is rolled
back, so the migration succeeds regardless.
Resolution: ADR-0008.
Regression verification: Covered by the probe's savepoint rollback; a device without FTS5
is not yet available to test against.
Status: implemented, device verification pending

### EDGE-0008

Scenario: Habit deleted by the user.
Affected feature: Habits, history, analytics
Expected behavior: No history is destroyed.
Actual behavior: Handled. Deletion is a soft delete (`deleted_at`); the habit disappears
from lists but its `habit_logs` rows remain and its statistics still resolve.
Resolution: Soft-delete policy.
Regression verification: `habits.test.ts` -> "keeps logs after a soft delete".
Status: verified

### EDGE-0009

Scenario: Very large numbers of habits, workouts or sessions.
Affected feature: Lists, analytics
Expected behavior: Scrolling and queries stay responsive.
Actual behavior: Unresolved. Repositories currently read unbounded ranges in a few places
(notably `computeHabitStats` reads a year of logs). Indexes exist, but pagination and
virtualised lists have not been implemented.
Resolution: Required before large libraries are plausible.
Regression verification: None yet — needs a performance test with realistic data volume.
Status: discovered

### EDGE-0010

Scenario: App terminated mid-write.
Affected feature: All data
Expected behavior: Either the write fully commits or it does not happen at all.
Actual behavior: Partially verified. WAL journaling is enabled and each migration is
transactional; individual habit writes are single statements and therefore atomic. A
full kill-during-write test requires a device.
Resolution: Single-statement writes plus WAL.
Regression verification: Not possible off-device.
Status: discovered, needs device verification

### EDGE-0011

Scenario: The app is killed part way through importing a PDF.
Affected feature: Books / PDF library
Expected behavior: The library never contains an entry whose file is missing. At worst an
unusable file is left on disk and cleaned up automatically.
Actual behavior: Satisfied by design. Import writes `books/<name>.pdf.part`, validates the
stored bytes, atomically renames, and only then does the caller insert the database row.
`cleanupInterruptedImports` removes orphaned `.part` files on the next launch.
Resolution: File-before-row ordering, reverse of deletion (ADR-0017).
Regression verification: `tests/integration/pdf.test.ts` — "sweeps orphaned .part files on
the next launch" and "never leaves a .part file behind on success".
Status: verified off-device; device verification outstanding

### EDGE-0012

Scenario: A PDF whose page tree contains a cycle, or a file whose cross-reference table is
wrong or missing.
Affected feature: PDF parser
Expected behavior: The document still opens, and the app never hangs.
Actual behavior: Satisfied. The parser indexes objects by scanning for `N G obj` markers
instead of following the xref table, and the page-tree walk is cycle-guarded and
depth-limited. Without those guards a malformed file that points `/Kids` at its own parent
would loop forever on a file the user is trying to read.
Resolution: Marker scanning plus visited-set and depth limits.
Regression verification: `tests/integration/pdf.test.ts` — "does not hang on a cyclic page
tree", and the parser is exercised against a fixture with no trailer.
Status: verified off-device

### EDGE-0013

Scenario: A document that cannot be searched or rendered.
Affected feature: PDF reader
Expected behavior: The reader says which features are unavailable instead of showing
controls that silently do nothing.
Actual behavior: Satisfied. Capabilities are measured per document at open time.
`StructurePdfEngine` reports `rendering: false` and `textSearch: false` because it does
not rasterise and does not decompress Flate streams.
Resolution: Capability flags carried on the document handle (ADR-0006).
Regression verification: `tests/integration/pdf.test.ts` — "opens a valid document and
reports measured capabilities".
Status: verified off-device; the reader screen that surfaces these states does not exist yet

### EDGE-0014

Scenario: A resume position beyond the end of the document, e.g. a page count read from a
damaged file.
Affected feature: Books
Expected behavior: The reader is never told to open a page outside the document.
Actual behavior: Enforced by the schema (`CHECK (page_count = 0 OR current_page <=
page_count)`), so an invalid position fails the write rather than being stored.
Resolution: Database constraint rather than application validation, so no call path can
bypass it.
Regression verification: `tests/integration/books.test.ts` — "rejects a resume page beyond
the end of the document".
Status: verified

### EDGE-0015

Scenario: The device filesystem reports a failure the app has never seen.
Affected feature: Book import on iOS and Android
Expected behavior: The user gets an honest message, not a confident wrong one.
Actual behavior: `classify` maps known native messages onto `StorageError` codes and falls
back to a generic `IO` error preserving the original message. There is a test asserting
that an unknown failure never becomes a specific code, because a wrong "not enough space"
would send the user to delete something they did not need to.
Resolution: Conservative fallback (ADR-0018). This is a known weakness: it relies on
message text that varies by platform and OS version.
Regression verification: `tests/unit/expoStorage.test.ts` — "never invents a specific
code for an unknown failure" and the `classify` table.
Status: verified off-device; **unverified against real iOS and Android error text**

### EDGE-0016

Scenario: The user imports a PDF, then deletes or replaces the file from the system
Files app while LifeOS is closed.
Affected feature: PDF reader
Expected behavior: The reader explains that the file is gone and offers a way back, not a
blank page or a crash.
Actual behavior: Satisfied. `openBook` re-reads the file on every open rather than
caching a parsed document, so a changed file is detected. The engine returns a typed
`missing` failure which the reader renders with its own wording and a "Back to library"
action.
Resolution: Re-read on open; typed `missing` failure surfaced by the reader screen.
Regression verification: `tests/integration/booksService.test.ts` — "reports a file deleted
behind the app rather than failing silently".
Status: verified off-device

### EDGE-0017

Scenario: A very large PDF is imported.
Affected feature: Book import
Expected behavior: The file's magic number is checked without loading the whole document
into memory, and an oversized file is refused before any storage is consumed.
Actual behavior: Satisfied. `readHead` opens a read handle and reads only the requested
prefix rather than calling `bytes()` on the whole file, and the size limit is checked
against the stored copy's stat before parsing.
Resolution: Bounded read plus a pre-parse size check.
Regression verification: `tests/unit/expoStorage.test.ts` — "reads only the requested head,
not the whole file"; `tests/integration/pdf.test.ts` — "rejects an oversized PDF and keeps
no partial file".
Status: verified off-device

### EDGE-0018

Scenario: The device clock is corrected backwards, or the user changes timezone, while a
focus session is running.
Affected feature: Focus timer
Expected behavior: The timer never shows more time remaining than the session started with,
and never reports negative elapsed time.
Actual behavior: Satisfied. `readTimer` clamps both `remainingMs` and `elapsedMs` to the
planned window, so `remainingFraction` is always within 0..1.
Resolution: Clamp both ends of the window. This was found by a test asserting the
invariant, not by inspection — the first implementation clamped only elapsed time.
Regression verification: `tests/unit/focus.test.ts` — "survives the device clock moving
backwards", "never reports negative time when reopened past the deadline".
Status: verified off-device

### EDGE-0019

Scenario: The app is killed while a focus session is running, and the user reopens it after
the session's deadline has passed.
Affected feature: Focus timer
Expected behavior: The session is resolved rather than left running forever, and the user
is not offered a timer that has already expired.
Actual behavior: Satisfied. `recoverStaleSession` runs on launch and completes such a
session, with `actual_sec` capped at the planned length so a session left open for a week
does not report a week of focus. This also matters mechanically: the partial UNIQUE index
allows only one `active` session, so a session left unresolved would block every future
timer.
Resolution: Launch-time recovery; recorded as completed rather than abandoned, because the
user did run it and the app simply was not open to see it end.
Regression verification: `tests/integration/focus.test.ts` — "recovery after the app was
killed", including "frees the single-session slot after recovery" and "is safe to run
twice".
Status: verified off-device

### EDGE-0020

Scenario: A weekly review or a weekly budget period lands on the wrong ISO week.
Affected feature: Reviews, budgets
Expected behavior: A date maps to the ISO week a reader would recognise, consistently across
year boundaries and 52- versus 53-week years.
Actual behavior: Fixed. `isoWeekKey` shifted by a fixed `+3` days to reach the week's
Thursday, which lands on the Sunday of the same week for a Thursday. Every Thursday and
later day was filed one week too high. The original tests asserted only the *shape* of the
key, so this passed review unnoticed.
Resolution: Shift to the Thursday of the current week (`- dayNumber + 3`) using a
Monday-based weekday index. Tests now assert exact week numbers, including 2026 (53 weeks)
and 2024 (52 weeks).
Regression verification: `tests/unit/dates.test.ts` — "ISO week numbering", 13 exact cases
plus a whole-week consistency case.
Status: verified

### EDGE-0021

Scenario: A night of sleep crosses midnight, e.g. bedtime 23:00 and wake 07:00.
Affected feature: Sleep logging
Expected behavior: The night is stored with the correct dates on both ends, so the duration
is right and the schema's `CHECK (wake_time >= bedtime)` is satisfiable.
Actual behavior: Fixed. `resolveSleepWindow` compared two parsed *objects* with `>`, which
stringifies both to `"[object Object]"` and is always false, so the bedtime was never
placed on the previous day. Every cross-midnight night was treated as a same-day one and
produced a nonsensical duration. The comparison is now made on minutes since midnight.
Resolution: `sleep_date` is defined as the wake-up date; a bedtime later than the wake time
belongs to the previous evening.
Regression verification: `tests/unit/health.test.ts` — "handles a night that crosses
midnight"; `tests/integration/health.test.ts` — "logs a night that crosses midnight" and
"stores the bedtime on the previous evening for a late night".
Status: verified

### EDGE-0022

### EDGE-0029

Scenario: A transfer is stored as two matched rows, both positive, both `kind = 'transfer'`.
Migration 009 states that direction is carried by `kind` — but for a transfer `kind` is
identical on both sides, so it carries no direction for *this* account's balance. There is
no `direction` or signed-amount column.
Affected feature: Finance transfers
Expected behavior: Each account's balance moves in exactly one direction, and the two legs
cancel across the pair.
Actual behavior: Satisfied by derivation rather than storage. Within a pair, the row with
the lexicographically smaller `id` is the source; money leaves that account and arrives at
the other's. This needs no schema change, is stable because ids are immutable, and is
computable from a single row without loading its peer.
Resolution: `src/finance/transfers.ts` documents the convention explicitly and
`transferNetsToZero` states the invariant. `recordTransfer` assigns ids so the source leg
always gets the smaller one, making the convention hold by construction rather than by
assumption — see EDGE-0033, which is where that was actually found. **This remains a
documented workaround, not the ideal model.** If the convention proves confusing in
practice, the fix is a `direction` column in a new migration — not a subtler ordering rule.
Regression verification: `tests/unit/finance.test.ts` — "nets to zero across the pair",
"shows the outflow in the source balance and the inflow in the target"; and
`tests/integration/finance.test.ts` — "keeps every transfer pair netting to zero".
Status: verified for the current code; the schema limitation itself remains

### EDGE-0030

Scenario: A transfer's first leg is written and the second fails, e.g. a storage error or
a quota limit between the two inserts.
Affected feature: Finance transfers
Expected behavior: Both legs appear or neither does. A half-written transfer would put
money in one account and not the other with nothing to explain it — the worst failure a
ledger can have.
Actual behavior: Satisfied. `recordTransfer` writes the pair inside one `BEGIN`/`COMMIT` and
issues `ROLLBACK` on any error. Tested by injecting a failure into the second insert:
`tests/integration/finance.test.ts` — "leaves no orphan when a leg cannot be written"
asserts zero surviving transfer rows. Deleting one leg later also removes its peer, so an
orphan cannot be created by ordinary use either.
Regression verification: the test above, plus "deletes both legs together".
Status: verified

### EDGE-0031

Scenario: A user types a negative amount, e.g. `-10.00`, into an expense.
Affected feature: Finance transactions, transfers, budgets
Expected behavior: Refused. Direction is carried by `kind`, and silently taking the absolute
value would record the opposite of what the user typed.
Actual behavior: Satisfied. `recordTransaction`, `recordTransfer` and `setBudget` each reject
a negative amount with a field message rather than coercing it. This was a genuine bug
during implementation: `Math.abs()` was applied and `-10.00` was stored as `+10.00`, caught
by the integration test asserting rejection. The schema's `CHECK (amount_minor > 0)` is the
backstop for any caller that bypasses the service.
Regression verification: `tests/integration/finance.test.ts` — "rejects a negative amount"
and "refuses a non-positive amount at the storage layer too".
Status: verified

### EDGE-0032

Scenario: A user transfers money between accounts holding different currencies, e.g. 100.00
from a USD account to a PHP account.
Affected feature: Finance transfers
Expected behavior: Refused. One `amount_minor` sits on both rows and the schema does not
check that the accounts share a currency, so the same number would silently mean two
different amounts.
Actual behavior: Satisfied at the service boundary by `validateTransfer`, which also rejects
a transfer to the same account. Converting between currencies is deliberately **not**
implemented: `FEATURES/FINANCE.md` asks for PHP, USD, EUR and custom currencies to be
*supported*, which is satisfied by storing and formatting any ISO-4217 code with its correct
### EDGE-0033

Scenario: A transfer's two legs are created with random UUIDv4 ids, and direction is derived
from which id is lexicographically smaller (EDGE-0029).
Affected feature: Finance transfers
Expected behavior: The leg belonging to the *source* account is always the one with the
smaller id, so the money always leaves the account the user chose it left.
Actual behavior: **Was broken; now fixed.** `recordTransfer` originally generated
`sourceId` then `targetId` and used them in call order. Because UUIDs are random, roughly
half of all transfers stored the pair inverted — the balance of the destination account
decreased and the source account increased. The total across accounts still conserved, so
the `transferNetsToZero` invariant did **not** catch it; only a per-account assertion did.
Resolution: The two ids are now compared and assigned so the smaller is always the source
leg, making the stored data match the documented convention by construction. This also
retires part of EDGE-0029's risk: the convention is no longer an assumption about how ids
were generated.
Regression verification: `tests/integration/finance.test.ts` — "always records the outgoing
leg with the smaller id" installs a deterministic descending id generator to force the
previously-failing case, then asserts both balances. Verified over six consecutive runs.
Status: verified. **Lesson: a conservation invariant is necessary but not sufficient.** The
per-account direction assertion is what found this, so both must stay.

### EDGE-0034

Scenario: A `?? []` fallback in a screen body creates a fresh array on every render.
Affected feature: Finance UI
Expected behavior: Derived memos actually memoise.
Actual behavior: Caught by lint (`react-hooks/exhaustive-deps`) before it shipped. The
`activeAccount` memo listed an array that was a new reference each render, so it re-ran
every time and provided no benefit while looking correct.
Resolution: The four list fallbacks are now wrapped in `useMemo`. Worth remembering because
the symptom is invisible — no wrong output, just wasted work and a misleading dependency
array that would hide a real bug later.
Regression verification: `eslint` reports zero warnings.
Status: verified

minor-unit exponent — not by inventing exchange rates. A conversion feature would need a
rate source, and the specification keeps finance local by default.
Regression verification: `tests/unit/finance.test.ts` — "rejects a transfer between
different currencies"; `tests/integration/finance.test.ts` — same at the service level.
Status: verified

Scenario: The user enters a volume in a unit other than millilitres, e.g. "1.5 l" or
"16 oz".
Affected feature: Hydration
Expected behavior: The amount is recorded in whole millilitres, without silently changing
the number by more than rounding, and input in an unknown unit is rejected rather than
guessed.
Actual behavior: Satisfied. Litres are exact; US fluid ounces (`29.5735295625 ml`) are
rounded to the nearest millilitre because `amount_ml` is INTEGER, a documented cost of at
most 0.5 ml. Parsing is strict: `"2 cups"` returns null rather than being assumed to mean
500 ml.
Resolution: Explicit conversion at the boundary; integer storage thereafter.
Regression verification: `tests/unit/health.test.ts` — "keeps the fluid-ounce error below
half a millilitre", "rejects input it cannot parse rather than guessing".
Status: verified

### EDGE-0023

Scenario: A user corrects the nutrition values of a food they have already eaten.
Affected feature: Nutrition
Expected behavior: The correction applies going forward and does not rewrite past entries.
Actual behavior: Satisfied by the snapshot rule from migration 007: `nutrition_entries`
stores its own copy of calories and macros rather than reading them from `foods`.
Regression verification: `tests/integration/health.test.ts` — "stores a snapshot that
survives editing the food", which asserts against the raw columns after editing the food.
Status: verified

### EDGE-0024

Scenario: A rounding claim about nutrition scaling does not hold — n sub-servings do not
re-sum to n times the whole serving.
Affected feature: Nutrition
Expected behavior: The limitation is documented rather than assumed away.
Actual behavior: Recorded. `scaleNutrition` rounds once per field to whole tenths of a
gram, so a quarter serving of a 15.0 g protein food stores 3.8 g rather than 3.75 g. The
per-entry loss is bounded by 0.05 g. `scaleNutrition` documents that it makes no claim
about sub-servings re-summing, and the test asserts a bounded error instead of exactness.
Resolution: Documented limitation of an integer schema, not a defect.
Regression verification: `tests/unit/health.test.ts` — "bounds the loss from rounding a
quarter serving".
Status: verified; accepted as inherent to the integer column

### EDGE-0025

Scenario: Recovery ratings (energy, soreness, recovery, mood) are specified but have no
table.
Affected feature: Health
Expected behavior: The gap is visible rather than quietly skipped.
Actual behavior: **Not implemented, and deliberately not invented.** `FEATURES/HEALTH.md`
specifies recovery ratings, but migration 007 defines only `water_logs`, `foods`,
`nutrition_entries` and `sleep_logs`. Building the feature would require a new
migration, which is a schema decision rather than an implementation detail.
Resolution: Recorded in `PROJECT_STATUS.md` as needing migration 013.
Regression verification: None — there is no code to test.
Status: deferred, needs migration 013

### EDGE-0026

Scenario: Journal search returns nothing even though matching entries exist.
Affected feature: Journal
Expected behavior: Search returns the matching entries on both the FTS5 and `LIKE` paths.
Actual behavior: Fixed. `searchEntries` re-joined the search hit row ids with
`SELECT * FROM journal_entries WHERE rowid IN (...)`. SQLite's `rowid` is implicit and is
**not** returned by `SELECT *`, so every row came back with `rowid` undefined, the ordered
map never matched, and search silently returned an empty list on both paths. The FTS5
query itself was always correct. Fixed by selecting `rowid` explicitly.
Resolution: List implicit columns explicitly when a query joins on them.
Regression verification: `tests/integration/journal.test.ts` — the whole `search` block,
including "uses the index when FTS5 is available" and "returns the same matches when FTS5
is unavailable", which together cover both engines.
Status: verified

### EDGE-0027

Scenario: Journal contents are transmitted to a server, silently or otherwise.
Affected feature: Journal
Expected behavior: `FEATURES/JOURNAL.md` requires that contents never leave the device
without the user doing something explicit.
Actual behavior: Enforced structurally. A test walks the journal module graph and fails if
any networking library is imported; a second test asserts the service exposes no
`export function sync|share|upload|publish|send`. Entries are stored unencrypted in the app
sandbox, and nothing in the app claims otherwise.
Resolution: Assert the property in code, not in a comment.
Regression verification: `tests/integration/journal.test.ts` — `describe('privacy')`.
Status: verified for the current code; **any future sync feature must revisit this
deliberately, and update the test in the same change**

### EDGE-0028

Scenario: The device's SQLite build has no FTS5, as some Android system builds ship.
Affected feature: Journal search
Expected behavior: Search still works, and the user is told it is on the slower path.
Actual behavior: Satisfied. `searchJournal` reads the capability recorded by migration 012
and falls back to `LIKE` over the base table. `journal/search` also falls back if an FTS5
query is rejected, because a user's words must never fail a search. The screen states when
it fell back.
Resolution: Capability detection, mirroring migration 012's own decision.
Regression verification: `tests/integration/journal.test.ts` — "returns the same matches
when FTS5 is unavailable" asserts both the `like` strategy and the same 2 matches.
Status: verified off-device; real Android builds without FTS5 are unverified here


