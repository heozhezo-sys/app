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
- Personal finance
- PDF book library and offline reader
- Analytics, achievements and reviews
- Backup and restore
- Optional synchronization

## Build host constraint

**This machine is Windows.** There is no Xcode, no iOS Simulator and no CocoaPods, so
an iOS build, install and device pass are **structurally impossible here**. That is
recorded as `DEVELOPMENT/KNOWN_ISSUES.md` ISSUE-002 rather than quietly marked
complete. Phases 21-23 of the specification require a macOS host.

The Android SDK is installed at `C:\Users\Razhil\AppData\Local\Android\Sdk`, but `adb`
is not on `PATH` and no emulator has been run, so Android runtime verification has not
happened either.

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
npm test           # 222 tests across 10 suites
npm run verify     # all three gates in sequence
```

## Current status

Verified on 2026-01-10: **typecheck passes, lint is clean, 222 tests pass.**

Implemented end to end: foundation, design system, database (12 migrations, 31 tables),
onboarding, Today dashboard, the **Habits** slice, the **Goals** slice with milestones
and tasks, and **Fitness** — workouts, sets, body metrics, personal records and a
47-sport catalogue, all sharing one activity architecture.

Not implemented yet: books/PDF reader, productivity and focus, health tracking, journal,
finance, analytics, notifications and backup/restore. Their database tables exist and are
tested, but a schema is not a feature.

Read `DEVELOPMENT/PROJECT_STATUS.md` before assuming anything is finished.

## Quality bar

No feature is complete when only its UI exists. CRUD, persistence, offline behavior,
errors, accessibility, dark mode, tests and iOS/Android verification are required.
