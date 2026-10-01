# LifeOS Platform Support

LifeOS is a cross-platform mobile application for **iOS and Android**.

## Primary platform

- iOS: current supported iPhone/iPad targets where Expo and required native modules support them.
- Android: current supported Android phone/tablet targets where Expo and required native modules support them.

## Core rule

No core feature may be designed as iOS-only.

Every feature must have a platform-neutral implementation first, with platform adapters only where native APIs differ.

## Required stack

- React Native
- Expo
- TypeScript
- Expo Router
- SQLite/local persistence
- SecureStore for secrets
- platform adapters for native capabilities

## Platform architecture

Shared application code:

- UI components
- navigation model
- business logic
- repositories
- database schema
- migrations
- analytics
- validation
- offline engine
- sync engine
- PDF library metadata
- reading progress

Platform adapters:

- HealthKit on iOS
- Health Connect on Android
- Face ID/Touch ID on iOS
- Android biometric authentication
- iOS Files/share APIs
- Android document picker/share APIs
- notification permission differences
- background execution differences

## Feature parity

A feature is not complete until its core behavior works on both iOS and Android.

If a native capability is unavailable on one platform, provide a graceful fallback rather than breaking the feature.

## Testing requirement

Every release candidate must be tested on at least one supported iOS device/simulator
and one supported Android device/emulator.

### Host limitation

The current build host is **Linux**. iOS builds require macOS with Xcode. Until a
macOS host is available, no claim of iOS verification may be made, and Phases 21-23 of
`START_DEVELOPMENT_TO_PRODUCTION.md` are blocked. See `DEVELOPMENT/KNOWN_ISSUES.md`
ISSUE-002.

No Android emulator or AVD is provisioned, so Android runtime verification is also
outstanding.

Nothing in this repository has been run on a device. Every "verified" claim in the
documentation means a command passed in this environment, and no more.

Test:

- fresh install
- upgrade
- offline mode
- database persistence
- PDF import
- PDF reading
- notifications
- permissions
- background/foreground transitions
- dark mode
- accessibility
- backup and restore

## UI rule

Use shared React Native components and platform-neutral layouts by default.
Use platform-specific components only when native behavior materially improves usability or is technically required.

## Health integrations

iOS HealthKit and Android Health Connect are optional integrations.
The app must continue to function without either service.

## Distribution

The application must be buildable for:

- iOS development
- iOS production
- Android development
- Android production

Maintain platform-specific configuration separately from shared business logic.
