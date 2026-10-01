# MASTER CHECKLIST

Honest state as of 2026-10-01. See `DEVELOPMENT/PROJECT_STATUS.md` for the full ledger,
`DEVELOPMENT/SPEC_TRACEABILITY.md` for requirement-by-requirement detail, and for what is
explicitly *not* implemented.

## Verified (command run, passed)

- [x] Architecture implemented (UI -> hooks -> services -> repositories -> SQLite)
- [x] Navigation structure and entry gate
- [x] Local database and migrations tested against real SQLite (schema v15, 15 migrations, 44 tables)
- [x] Schema integrity constraints verified by direct-SQL tests
- [x] Offline behaviour by construction: no core feature makes a network call
- [x] Habit CRUD, completion, undo, archive, restore, history, statistics
- [x] Goal lifecycle with an enforced state machine; milestones and tasks
- [x] Today's and overdue tasks on the Today dashboard
- [x] Workouts, sets, body metrics and derived personal records
- [x] 43 exercises and 47 sports seeded; custom sports supported
- [x] PDF import with validation, atomic rename and orphan sweep
- [x] Journal entries, tags, favourites, attachments, local search, export and lock gate
- [x] Finance accounts, transactions, atomic transfers, budgets and multi-currency
- [x] Analytics, achievements, calendar, reminders, backup and restore
- [x] Settings hub with appearance, units, currency, targets, reminders, privacy and data
- [x] TypeScript passes (`npm run typecheck`)
- [x] Lint passes (`npm run lint`, zero warnings)
- [x] **1017 tests pass across 36 suites (`npm test`)**

## Implemented, not device-verified

- [ ] Design system verified on a real iOS screen
- [ ] Design system verified on a real Android screen
- [ ] Dark mode verified on device
- [ ] Dynamic Type / font scaling verified on device
- [ ] VoiceOver pass
- [ ] TalkBack pass
- [ ] Android back navigation pass
- [ ] Metro production bundle build
- [ ] Upgrade migration verified on a real device (N -> N+1)

## Not started

- [ ] PDF page rendering and text search — requires a rasterising engine (ADR-0006)
- [ ] PDF reader zoom, page modes, sepia/black themes, and swipe/pinch gestures
- [ ] Recurring-transaction creation UI (schema and cadence rules exist)
- [ ] Sharing a backup off the device
- [ ] Full security audit (partial: see `SECURITY/SECURITY.md`)
- [ ] Performance audit

## Deliberately not built

- [ ] Optional cloud sync transport — the `sync_queue` outbox exists, but there is no
      remote service to talk to and no core feature may depend on one
- [ ] HealthKit and Health Connect adapters — optional enhancements that must never gate
      a core feature
- [ ] At-rest journal encryption — the lock is an authentication gate, and the docs say
      so rather than implying encryption (ADR-0021)

## Blocked by the environment

- [ ] Release build tested on a physical iPhone — **impossible on this Linux host**
- [ ] Release build tested on an Android device — no emulator or AVD provisioned

## Release gate

Do not ship until every unchecked item above is either completed or explicitly waived in
writing. The iOS device pass cannot be completed on this host at all; it requires macOS
with Xcode, and it is recorded as a hard limitation (ISSUE-002) rather than quietly marked
complete.
