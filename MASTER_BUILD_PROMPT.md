# MASTER BUILD PROMPT

Build LifeOS as a production-quality **cross-platform React Native + Expo + TypeScript mobile application for iOS and Android**.

## Non-negotiable requirements

1. iOS and Android are first-class supported platforms.
2. Offline-first and local-first.
3. No core feature may require internet for normal operation.
4. SQLite is the persistent source of truth.
5. Large files such as PDFs live in the filesystem, not SQLite.
6. Use migrations for schema changes.
7. Use repositories/services so UI is never coupled directly to storage.
8. Use Expo Router and modular feature architecture.
9. Support iOS and Android light/dark/system appearance.
10. Support Dynamic Type and Android font scaling.
11. Handle loading, empty, error, success and offline states everywhere.
12. Test critical workflows on both platforms.
13. Never assume an iOS-only filesystem path, API, permission, or interaction model.
14. Use platform adapters for native capabilities.

## Main modules

Today, Habits, Goals, Fitness, Sports, Books, Productivity, Journal, Health, Finance, Analytics and Settings.

## Native integrations

iOS:

- HealthKit
- Face ID/Touch ID
- Files/document providers
- Share Sheet
- iOS notifications

Android:

- Health Connect
- Android biometric authentication
- Android document providers
- Android Sharesheet
- Android notifications/channels

All integrations are optional enhancements. Manual workflows remain available.

## PDF requirement

Users import PDFs from iOS Files, Android document providers, Share Sheet, AirDrop where supported, Android sharing/document providers, and other supported sources.

Keep files local.

Provide reader progress, bookmarks, highlights, notes, search, TOC, themes, page modes and reading analytics.

## Cross-platform rule

Business logic must be platform-neutral.

Native APIs must be accessed through adapters.

Do not put platform-specific code inside repositories, database models, or core business logic.

## Delivery rule

Do not stop after scaffolding or UI.

Build → run → test → break intentionally → fix → retest → audit → document → continue.

A feature is complete only when it works offline and has been verified on iOS and Android.
