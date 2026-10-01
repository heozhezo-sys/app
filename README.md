# LifeOS

Cross-platform personal operating system for self-improvement, health, fitness, learning, productivity, reading, finance and personal analytics.

## Platforms

- iOS
- Android

Both platforms are first-class targets.

## Core scope

- Habits, goals, tasks and daily planning
- Gym, home workouts and sports
- Running, walking, cycling and swimming
- Mobility, stretching, yoga and recovery
- Sleep, hydration and nutrition
- Focus, productivity and journaling
- Personal finance, budgets and multiple currencies
- PDF book library and offline reader
- Analytics, calendar and achievements
- Local reminders
- Backup and restore
- Optional synchronization

## Build host constraint

**This machine is Linux.** There is no Xcode, no iOS Simulator and no CocoaPods, so an
iOS build, install and device pass are **structurally impossible here**. That is recorded
as `DEVELOPMENT/KNOWN_ISSUES.md` ISSUE-002 rather than quietly marked complete. Phases
21–23 of the specification require a macOS host.

No Android emulator or AVD is provisioned either, so Android runtime verification has not
happened. Nothing in this repository has been run on a device. Every "verified" claim in
the documentation means a command passed in CI, and no more.

iOS-specific behaviour must therefore be confined to `src/platform/*` adapters, which
return a capability result rather than throwing when a native API is unavailable. Shared
code must never branch on `Platform.OS`.

## Core architecture

LifeOS is local-first and offline-first.

Core user data is stored locally. SQLite is the source of truth for structured records. Large PDFs and media are stored in the application filesystem with database metadata.

Native capabilities use platform adapters so shared business logic works on both platforms.

## Core rule

The app must work without an account, server, internet connection or cloud sync for core functionality.

## Development

Before coding, read the complete documentation tree and inspect the actual project.

Start with:

1. `AGENTS.md`
2. `DEVELOPMENT/AGENT_KNOWLEDGE_PROTOCOL.md`
3. `MASTER_BUILD_PROMPT.md`
4. `START_DEVELOPMENT_TO_PRODUCTION.md`
5. `ARCHITECTURE.md`
6. `PLATFORM_SUPPORT.md`
7. relevant feature specifications

Then run the baseline and update `DEVELOPMENT/PROJECT_KNOWLEDGE.md`.

## Commands

```bash
npm install
npm start          # Metro
npm run typecheck  # tsc --noEmit
npm run lint       # eslint, zero warnings tolerated
npm test           # 1017 tests across 36 suites
npm run verify     # all three gates in sequence
```

## Current status

Verified on 2026-10-01: **typecheck passes, lint is clean, 1017 tests pass across 36 suites.**

Implemented end to end: foundation, design system, database (**schema v15, 15 migrations,
44 tables**), onboarding, Today dashboard, and every feature slice the specification names
— habits; goals with milestones and tasks; fitness with workouts, sets, body metrics and a
47-sport catalogue; books and the PDF reader; focus; hydration, nutrition and sleep;
recovery; the journal with export and a device-authentication lock; finance with budgets
and multi-currency conversion; analytics; achievements; calendar; local reminders; and
backup and restore with undo. Plus a Settings hub covering appearance, units, currency,
targets, reminders, privacy and data.

Deliberately absent rather than unfinished: the PDF engine reports that it cannot render
pages or search text; there is no rate feed for currency conversion (the user types the
rate); optional cloud sync has an outbox schema but no transport; HealthKit and Health
Connect are not implemented; and the journal lock is an authentication gate, not at-rest
encryption.

Read `DEVELOPMENT/PROJECT_STATUS.md` before assuming anything is finished.

## Quality bar

No feature is complete when only its UI exists. CRUD, persistence, offline behavior,
errors, accessibility, dark mode, tests and iOS/Android verification are required.
