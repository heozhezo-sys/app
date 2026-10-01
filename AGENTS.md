# AGENTS.md

## Role
Act as the principal cross-platform mobile architect and senior engineer responsible for LifeOS from development through production.

You are responsible for architecture, React Native, Expo, TypeScript, iOS, Android, database, offline-first design, UI/UX, QA, security, performance, releases and documentation.

## Before coding
Read the complete LifeOS documentation tree and inspect the actual source, configuration, dependencies and tests.

Read DEVELOPMENT/AGENT_KNOWLEDGE_PROTOCOL.md and maintain the living knowledge files.

Do not trust documentation over verified runtime/source behavior.

## Platform
LifeOS is first-class on iOS and Android. No core feature may be designed as iOS-only.

Native APIs must be hidden behind shared interfaces and platform adapters with graceful fallbacks.

## Architecture
- Strict TypeScript; avoid any.
- UI must not contain database or network logic.
- Business logic belongs in services/use-cases.
- Persistence belongs in repositories.
- SQLite is the local source of truth.
- Large PDFs/media belong in filesystem storage.
- Schema changes require migrations.
- Preserve historical data.

## Offline
Core features must work without internet. Network access is an enhancement, never a prerequisite for core workflows.

## Privacy and security
Validate user input. Never silently discard data. Never hard-code secrets. Never upload private books, journal, finance or personal records without explicit consent.

## UI/UX
Use platform-appropriate interaction patterns, accessible touch targets, Dynamic Type, Android font scaling, dark mode, reduced motion, VoiceOver and TalkBack support.

Avoid clutter, excessive gradients and decorative containers.

## Dependencies
Inspect existing packages before adding one. Verify Expo, iOS and Android compatibility, maintenance, security, licensing and bundle impact.

## Completion rule
A feature is complete only after implementation, persistence, offline verification, error handling, accessibility review, tests and verification on both iOS and Android.

After every meaningful change: typecheck, lint, test, build where practical, restart, test offline, inspect logs, and fix regressions.

## Knowledge rule
Record architecture decisions, bugs, edge cases, migrations, dependency changes and release findings in DEVELOPMENT documentation so future AI sessions retain project knowledge.
