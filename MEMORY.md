# MEMORY

## Product identity
Name: LifeOS
Platform: iOS + Android, with shared React Native + Expo code.
Primary goal: one calm personal system for self-improvement, health, fitness, learning, productivity, reading, finance and personal analytics.

## Architectural decisions

Full reasoning is in `DEVELOPMENT/DECISIONS.md`. Summary:

- Cross-platform first-class support; shared code contains no `Platform.OS` branches.
- Offline-first and local-first. No core feature needs the network.
- SQLite local source of truth, accessed only through a `SqlDriver` interface.
- The identical migration SQL is tested against real SQLite in CI (ADR-0001).
- Filesystem for PDFs and large media; the database holds metadata only.
- Repository/service boundaries; UI never touches SQL.
- Native integrations behind platform adapters returning
  `{ supported, reason, value }` rather than throwing.
- Optional cloud sync only; a `sync_queue` outbox exists but no transport.
- Local notifications for reminders, behind a `NotificationAdapter` that returns
  `available: false` where the OS cannot deliver them.
- PDF engine behind an abstraction with per-document capability flags (ADR-0006).
- Database changes require migrations; each is transactional and non-destructive.
- Money is integer minor units (ADR-0003). Calendar days are local, never UTC-derived.
- Exchange rates are **user-entered**, stored as micro-scaled integers. No rate feed:
  a stale fetched rate is worse than an explicit one because its age is invisible.
- Derived totals are never stored. Achievements, analytics, balances, budgets and the
  calendar are all computed on read, so deleting a record lowers the number immediately.
- Restore takes a safety copy first and stays undoable afterwards.
- Design tokens are centralised; components reference indices, not raw colours (ADR-0002).
- Status changes go through a pure, exhaustively tested state machine (ADR-0011).
- Goal progress is derived from milestones, never maintained by hand (ADR-0012).
- One activity architecture for all sports and workout types (ADR-0013).
- Weights are integer grams, so fractional plate weights are exact (ADR-0014).
- Reference data is seeded at runtime, never edited into a shipped migration (ADR-0015).
- Omitted input is never treated as invalid input (ADR-0016).
- Only implemented destinations appear in navigation (ADR-00010).
- Health and analytics copy describes, it never interprets: no medical claims, no
  "improved"/"worse" verdicts on a metric.

## Current state

Verified 2026-10-01: typecheck passes, lint is clean, **1017 tests pass across 36 suites**.
Schema v15: 15 migrations, 44 tables (42 application + 2 FTS5), seeded with 43 exercises
and 47 sports.

**Every feature slice the specification names is implemented end to end:** habits; goals
with milestones and tasks; fitness and sports; books and the PDF reader; focus; hydration,
nutrition and sleep; recovery; journal with export and a lock; finance with budgets and
multi-currency; analytics; achievements; calendar; reminders; and backup and restore. A
Settings hub covers appearance, units, currency, targets, reminders, privacy and data.

Two things follow from that and must not be forgotten:

1. **Nothing has been run on a device.** iOS verification is impossible on this Linux host
   (KNOWN_ISSUES ISSUE-002) and no Android emulator is provisioned. "Verified" throughout
   this project means a command passed, not that a person used the app.
2. **The PDF engine deliberately cannot render pages or search text.** It reports
   `rendering: false` and `textSearch: false` rather than faking them.

See `DEVELOPMENT/PROJECT_STATUS.md` before assuming anything is finished.

## UX direction

Premium, calm, native-feeling, minimal, readable and fast.
Today is the primary command centre, and it is also the hub for every secondary module.
Advanced functionality is progressively disclosed.
Support light, dark and system appearance.
Minimum 48pt touch targets; state is never conveyed by colour alone.
Discrete buttons, not sliders, wherever a value must be reachable by a screen reader.

## Privacy

Books, journal, finance and personal records remain local by default.
No background upload of user documents. No analytics SDK is installed.
Journal export omits entry bodies unless the user explicitly asks for them.
The journal unlock flag lives in memory only, so closing the app re-locks it.
Console logging is disabled in release builds; technical detail stays in a bounded
in-memory buffer that the user can read but that never leaves the device.

## Platform integrations

Written: the notification adapter (`src/platform/notifications/`), the biometric adapter
(`src/platform/biometrics/`), and the filesystem adapter (`src/platform/storage/`). Each
returns a capability or availability result rather than throwing, and each has a test
seam so the business logic above it is testable without the native module.

Not written: HealthKit and Health Connect. They are optional integrations, so manual entry
must remain available and no feature may depend on one being present.

## Agent knowledge
The living project knowledge system is maintained in DEVELOPMENT/.
See AGENT_KNOWLEDGE_PROTOCOL.md for the required process.
