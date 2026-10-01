# LifeOS AI Agent Knowledge Protocol

## Purpose

This file defines how the AI agent must build and preserve project knowledge before and during implementation.

## Source of truth hierarchy

1. Actual runtime behavior and source code
2. Database schema and migrations
3. Build configuration and installed dependency versions
4. Tests and verified behavior
5. Project documentation
6. Agent assumptions

When sources conflict, investigate instead of guessing.

## Required first-pass inspection

Read the complete LifeOS documentation tree, then inspect the actual project.
Record architecture, routes, data models, dependencies, native modules, tests, build state and known risks.

## Living knowledge files

Maintain these files continuously:

- DEVELOPMENT/PROJECT_KNOWLEDGE.md
- DEVELOPMENT/BASELINE.md
- DEVELOPMENT/KNOWN_ISSUES.md
- DEVELOPMENT/EDGE_CASES.md
- DEVELOPMENT/DECISIONS.md
- DEVELOPMENT/CHANGELOG.md

Never erase historical findings without recording why they changed.

## Knowledge update triggers

Update project knowledge when:

- architecture changes
- a dependency changes
- a database schema changes
- a platform adapter changes
- an offline rule changes
- a feature is added or removed
- a bug is discovered
- an edge case is discovered
- a migration is added
- a release is prepared

## Before implementation

The agent must understand:

- product requirements
- current implementation
- architecture
- data ownership
- offline behavior
- iOS behavior
- Android behavior
- failure modes
- security and privacy requirements
- testing requirements

## Before adding a dependency

Inspect existing packages first. Verify Expo, React Native, iOS and Android compatibility, maintenance, licensing, security and bundle impact.

## Before changing data

Inspect schema, migrations, repositories and existing assumptions. Plan backward-compatible migration and data-loss protection.

## Before changing native behavior

Identify both platform implementations and a fallback when the capability is unavailable.

## After implementation

Run typecheck, lint, relevant tests and builds. Test offline and both platforms. Try to break the feature intentionally.

## Never claim completion from UI alone

A feature requires working persistence, business logic, error handling, offline behavior, tests and cross-platform verification.
