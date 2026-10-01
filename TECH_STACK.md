# TECH STACK

Verified versions live in `package.json` and the lockfile. The versions below were
resolved by `expo install` for SDK 57 and confirmed on disk.

## Core

| Package | Resolved | Why |
|---|---|---|
| `expo` | ~57.0.26 | SDK the app is built and verified against |
| `react-native` | 0.86.3 | Pinned by the Expo SDK |
| `react` | 19.2.3 | Pinned by the Expo SDK |
| `expo-router` | ~57.0.24 | Navigation; file-based routing with typed routes |
| `typescript` | ~5.9.2 | Strict mode everywhere |

## Storage

| Package | Resolved | Why |
|---|---|---|
| `expo-sqlite` | ~57.0.3 | Local source of truth, accessed only through `SqlDriver` |
| `expo-secure-store` | ~57.0.4 | Keychain / Keystore for any future secret or lock state |

## Platform capabilities

| Package | Resolved | Why |
|---|---|---|
| `expo-notifications` | ~57.0.21 | Local reminders (feature not yet implemented) |
| `expo-document-picker` | ~57.0.3 | iOS Files and Android document providers for PDF import |
| `expo-file-system` | ~57.0.7 | PDF storage outside SQLite |
| `expo-sharing` | ~57.0.22 | iOS Share Sheet / Android Sharesheet |
| `expo-local-authentication` | ~57.0.3 | Face ID / Touch ID / BiometricPrompt for the journal lock |
| `expo-haptics` | ~57.0.3 | Haptic feedback |
| `expo-crypto` | ~57.0.x | Cryptographically strong UUIDs |

Only `expo-sqlite`, `expo-crypto`, `expo-router` and `expo-splash-screen` are actually
exercised by code today. The rest are installed ahead of the features that need them;
none is required by a currently implemented screen.

## State

| Package | Resolved | Why |
|---|---|---|
| `zustand` | ^5.0.15 | App-wide settings only. Data lives in SQLite, not in a store. |

**TanStack Query was deliberately not installed.** It was listed in the original spec
for "optional remote data", but LifeOS has no remote service and is offline-first.
Adding a network cache library for a network that does not exist would be dead weight.
See ADR-0004.

## Testing

| Package | Resolved | Why |
|---|---|---|
| `jest` | ^30.5.2 | Test runner |
| `jest-expo` | ^57.0.5 | React Native preset for component tests |
| `@testing-library/react-native` | ^14.0.1 | Component and accessibility-assertion queries |
| `test-renderer` | ^1.0.0 | Required peer of RNTL 14 (replaces `react-test-renderer`) |
| `@react-native/jest-preset` | ^0.86.3 | Must match the React Native version exactly |
| `eslint` | ^9.39.0 | v10 breaks `eslint-plugin-react` |
| `eslint-config-expo` | ^57.0.2 | Expo-appropriate rules |

`node:sqlite`, built into Node 22, provides the real SQLite engine used for migration
and repository tests. It is not a dependency.

## PDF

No engine selected yet. The `PDFReaderEngine` interface with per-document capability
flags is the plan (ADR-0006). An engine will only be adopted after checking Expo, iOS
and Android compatibility, licence and bundle impact.

## Principles

- Prefer Expo-compatible packages; native access stays behind adapters.
- Do not add a dependency without a concrete capability need. Everything installed
  today is justified above.
- Pin versions. `@react-native/jest-preset` in particular must match React Native
  exactly or the whole suite fails to boot.
