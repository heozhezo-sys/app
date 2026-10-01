# Cross-Platform Testing

LifeOS must be tested as one shared application with two platform implementations.

## Required targets

- iOS simulator/device
- Android emulator/device

## Critical parity tests

- install
- onboarding
- navigation
- create/edit/delete habit
- create/edit/delete goal
- create workout
- log sport
- import PDF
- open PDF
- save reading progress
- bookmark page
- create note
- journal entry
- hydration log
- focus timer
- notifications
- backup
- restore
- app restart
- offline operation
- upgrade/migration

## Platform-specific tests

### iOS

- Files picker
- Share Sheet
- HealthKit availability
- Face ID/Touch ID
- notification permissions
- safe areas
- Dynamic Type

### Android

- document picker
- Sharesheet
- Health Connect availability
- biometric authentication
- notification channels/permissions
- Android back behavior
- font scaling
- device storage restrictions

## Parity rule

A platform-specific limitation must be documented and must have either:

- equivalent behavior
- manual fallback
- explicit unsupported-state UI

Never silently remove functionality on one platform.
