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
- Local notifications for reminders (not yet implemented).
- PDF engine behind an abstraction with per-document capability flags (ADR-0006).
- Database changes require migrations; each is transactional and non-destructive.
- Money is integer minor units (ADR-0003). Calendar days are local, never UTC-derived.
- Design tokens are centralised; components reference indices, not raw colours (ADR-0002).
- Status changes go through a pure, exhaustively tested state machine (ADR-0011).
- Goal progress is derived from milestones, never maintained by hand (ADR-0012).
- One activity architecture for all sports and workout types (ADR-0013).
- Weights are integer grams, so fractional plate weights are exact (ADR-0014).
- Reference data is seeded at runtime, never edited into a shipped migration (ADR-0015).
- Omitted input is never treated as invalid input (ADR-0016).
- Only implemented destinations appear in navigation (ADR-00010).

## Current state

Verified 2026-01-10: typecheck passes, lint is clean, 222 tests pass across 10 suites.
Twelve migrations and 31 tables exist, seeded with 43 exercises and 47 sports. **Four
vertical slices are implemented end to end** — habits; goals with milestones and tasks;
fitness with workouts, sets and body metrics; and sport sessions. Every other domain has
schema but no feature code. iOS verification is impossible on the current Windows host
and is recorded as a hard limitation.

See `DEVELOPMENT/PROJECT_STATUS.md` before assuming anything is finished.

## UX direction

Premium, calm, native-feeling, minimal, readable and fast.
Today is the primary command centre.
Advanced functionality is progressively disclosed.
Support light, dark and system appearance.
Minimum 48pt touch targets; state is never conveyed by colour alone.

## Privacy

Books, journal, finance and personal records remain local by default.
No background upload of user documents. No analytics SDK is installed.
Console logging is disabled in release builds; technical detail stays in a bounded
in-memory buffer that the user can read but that never leaves the device.

## Platform integrations

Optional iOS integrations include HealthKit, Face ID / Touch ID, Files, Share Sheet and
notifications. Optional Android integrations include Health Connect, BiometricPrompt,
document providers, Sharesheet and notification channels.

None of these adapters has been written yet. Manual entry must remain available, and no
feature may depend on an optional native capability being present.

## Agent knowledge
The living project knowledge system is maintained in DEVELOPMENT/.
See AGENT_KNOWLEDGE_PROTOCOL.md for the required process.
