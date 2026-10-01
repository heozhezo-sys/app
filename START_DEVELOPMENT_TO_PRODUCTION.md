# LIFEOS

# START DEVELOPMENT → PRODUCTION MASTER PROMPT

You are the principal engineer responsible for taking the LifeOS application from its current state all the way to a stable production release.

You are simultaneously acting as:

* Principal Software Architect
* Senior React Native Engineer
* Senior Expo Engineer
* iOS Engineer
* Android Engineer
* TypeScript Engineer
* Database Engineer
* Offline-First Architect
* UI/UX Engineer
* Accessibility Engineer
* QA Engineer
* Security Engineer
* Performance Engineer
* DevOps/Release Engineer
* Technical Writer
* Long-Term Maintenance Engineer

Your job is NOT simply to generate code.

Your job is to build, verify, break, repair, harden, document, and release a real application.

The final product must be a production-quality cross-platform application for:

* iOS
* Android

The application must remain useful offline.

---

# 1. ABSOLUTE RULE

DO NOT START CODING BLINDLY.

First inspect the complete LifeOS project and documentation.

Project documentation:

D:\lab\applications\LifeOS

Read all relevant Markdown files before making architectural decisions.

At minimum inspect:

* README.md
* AGENTS.md
* MEMORY.md
* MASTER_BUILD_PROMPT.md
* ARCHITECTURE.md
* TECH_STACK.md
* PROJECT_STRUCTURE.md
* PLATFORM_SUPPORT.md
* UI_UX/*
* FEATURES/*
* BOOKS/*
* OFFLINE/*
* DATA/*
* IOS/*
* UPDATES/*
* SECURITY/*
* TESTING/*
* DEVELOPMENT/*
* ROADMAP/*
* CHECKLISTS/*

Treat these documents as the current project contract.

---

# 2. NEVER TRUST DOCUMENTATION BLINDLY

Documentation can be outdated.

After reading it:

COMPARE:

Documentation
VS
Actual source code
VS
Installed dependencies
VS
Build configuration
VS
Actual runtime behavior

If they disagree:

1. Identify the disagreement.
2. Determine the actual current state.
3. Decide the safest correction.
4. Update documentation.
5. Record the architectural decision in MEMORY.md.

Never silently ignore discrepancies.

---

# 3. INSPECT THE ACTUAL MACHINE

Before implementation inspect:

* project directory
* package.json
* lockfile
* Expo configuration
* app configuration
* TypeScript configuration
* Metro configuration
* Babel configuration
* ESLint configuration
* native configuration
* assets
* routes
* source code
* database
* migrations
* tests
* scripts
* environment files
* Git status

Determine:

* Node version
* npm/pnpm/yarn
* Expo SDK
* React Native version
* TypeScript version
* installed native packages
* platform compatibility

Do not assume versions.

---

# 4. CREATE A BASELINE

Before changing anything run all available:

* type checking
* linting
* tests
* build validation
* Expo validation
* dependency checks

Record existing problems.

Create:

DEVELOPMENT/BASELINE.md

Separate:

EXISTING PROBLEMS

from:

NEW PROBLEMS INTRODUCED BY YOUR WORK

Never hide baseline failures.

---

# 5. CHECK GIT

Inspect:

* current branch
* uncommitted changes
* staged changes
* recent commits
* ignored files

NEVER destroy existing user work.

Never reset the repository blindly.

Never delete files simply because you do not understand them.

---

# 6. BUILD STRATEGY

Use vertical feature slices.

Never build:

"all screens first"

and then attempt to make them functional later.

For each feature build:

DATABASE
↓
MIGRATION
↓
REPOSITORY
↓
SERVICE
↓
STATE
↓
HOOK
↓
UI
↓
VALIDATION
↓
ERROR HANDLING
↓
TESTS
↓
OFFLINE TEST
↓
ACCESSIBILITY TEST
↓
PERFORMANCE TEST
↓
FINAL REVIEW

Only then mark it complete.

---

# 7. DEVELOPMENT PHASES

Follow this order.

## PHASE 0

Project audit.

## PHASE 1

Foundation.

## PHASE 2

Database and persistence.

## PHASE 3

Design system.

## PHASE 4

Onboarding and Today dashboard.

## PHASE 5

Habits.

## PHASE 6

Goals and tasks.

## PHASE 7

Fitness.

## PHASE 8

Sports.

## PHASE 9

Books and PDF reader.

## PHASE 10

Productivity and focus.

## PHASE 11

Health tracking.

## PHASE 12

Journal.

## PHASE 13

Finance.

## PHASE 14

Analytics and achievements.

## PHASE 15

Notifications.

## PHASE 16

Backup and restore.

## PHASE 17

Optional synchronization.

## PHASE 18

Security audit.

## PHASE 19

Performance audit.

## PHASE 20

Accessibility audit.

## PHASE 21

Cross-platform testing.

## PHASE 22

Release candidate.

## PHASE 23

Production release.

---

# 8. PHASE 0 — PROJECT AUDIT

Do not modify application behavior yet.

Determine:

* what already works
* what partially works
* what is broken
* what is missing
* what is duplicated
* what is obsolete
* what is dangerous
* what is incorrectly architected

Produce:

DEVELOPMENT/PROJECT_AUDIT.md

Include:

* findings
* risks
* recommended fixes
* technical debt
* architecture conflicts

Then proceed.

---

# 9. PHASE 1 — FOUNDATION

Create a stable foundation.

Required:

* Expo
* React Native
* TypeScript
* Expo Router
* strict TypeScript
* centralized theme
* reusable components
* error boundary
* logging
* environment configuration
* feature modules
* service layer
* repository layer
* validation layer
* testing foundation

Avoid giant files.

---

# 10. ARCHITECTURE

Use:

UI
↓
Hooks
↓
Services
↓
Repositories
↓
SQLite/filesystem

Remote services must never be directly called by random UI components.

Native APIs must use adapters.

Example:

HealthService

iOS implementation:
HealthKit

Android implementation:
Health Connect

Shared application code must not directly depend on either API.

---

# 11. CROSS-PLATFORM REQUIREMENT

LifeOS is a FIRST-CLASS:

* iOS application
* Android application

Do not build iOS first and "port it later."

Build shared functionality from the beginning.

Every feature must answer:

"What happens on iOS?"

"What happens on Android?"

"What happens if the native capability is unavailable?"

---

# 12. NATIVE PLATFORM ADAPTERS

Create abstractions for:

Health
Biometrics
Documents
Sharing
Notifications
File access
Background behavior

Example:

HealthService
├── IOSHealthService
└── AndroidHealthService

BiometricService
├── IOSBiometricService
└── AndroidBiometricService

DocumentService
├── IOSDocumentService
└── AndroidDocumentService

---

# 13. IOS

Support where available:

* HealthKit
* Face ID
* Touch ID
* Files
* Share Sheet
* notifications
* Dynamic Type
* safe areas
* native navigation behavior

Never make these mandatory for the core app.

---

# 14. ANDROID

Support where available:

* Health Connect
* biometric authentication
* Android document providers
* Android Sharesheet
* notification channels
* Android back navigation
* font scaling
* Android lifecycle behavior

Never assume Android behaves like iOS.

---

# 15. DATABASE

Use SQLite as the local source of truth.

Use migrations.

Never casually delete or recreate the database during development.

Critical data must survive:

* app restart
* app update
* device restart
* offline periods
* migrations

---

# 16. DATA INTEGRITY

Prefer historical records over manually maintained totals.

Example:

BAD:

totalReadingMinutes = 250

GOOD:

reading_sessions

Then calculate:

totalReadingMinutes

Use this principle for:

* reading
* workouts
* habits
* hydration
* focus
* finance
* sports
* sleep
* goals

Preserve history.

---

# 17. DATABASE SAFETY

Every destructive database operation must be reviewed.

Test:

* migration from old version
* migration to new version
* interrupted migration
* invalid migration
* duplicate records
* missing records
* corrupted records

Never allow a migration failure to silently erase user data.

---

# 18. FILE STORAGE

Large files do NOT belong in SQLite.

Store PDFs/images/large attachments in controlled application storage.

SQLite stores metadata.

Example:

Book record:

id
title
author
filePath
pageCount
progress

PDF binary:

filesystem

---

# 19. PDF BOOK SYSTEM

The PDF feature must be a major production feature.

User flow:

Import PDF
↓
Validate file
↓
Copy/persist locally
↓
Extract metadata
↓
Create database record
↓
Show library
↓
Open reader
↓
Track progress

Support:

* iOS Files
* Android document providers
* sharing/import
* local PDFs
* large PDFs
* offline reading

---

# 20. PDF READER

Support:

* page navigation
* continuous scroll where supported
* zoom
* page slider
* bookmarks
* reading progress
* notes
* highlights where supported
* search where supported
* table of contents where available
* dark theme
* sepia theme
* black theme
* full-screen mode
* landscape/two-page mode where supported

Never assume every PDF supports every feature.

The UI must clearly indicate unsupported capabilities.

---

# 21. PDF FAILURE HANDLING

Test:

* corrupted PDF
* password-protected PDF
* huge PDF
* missing PDF
* moved PDF
* deleted PDF
* invalid file extension
* interrupted import
* insufficient storage
* application killed during import
* app killed during reading

Never crash.

---

# 22. HABITS

Implement full:

Create
Read
Update
Delete
Archive
Restore
Complete
Undo
History
Statistics
Reminders

Test:

* duplicate completion
* missed days
* timezone changes
* date boundaries
* app restart
* offline mode

---

# 23. GOALS

Support:

* goals
* milestones
* tasks
* deadlines
* progress
* notes
* status
* history

Statuses:

* active
* paused
* completed
* cancelled
* archived

Do not allow invalid state transitions.

---

# 24. FITNESS

Implement:

* Gym
* Home Workout
* Running
* Walking
* Cycling
* Swimming
* Sports
* Mobility
* Stretching
* Recovery

Create reusable activity architecture.

Do not duplicate entire systems for every sport.

---

# 25. GYM

Support:

* exercises
* muscle groups
* equipment
* sets
* reps
* weight
* duration
* RPE
* rest
* notes
* workout templates
* personal records
* history

Test:

* bodyweight
* zero weight
* fractional weight
* incomplete sets
* interrupted workout
* duplicate taps
* invalid values

---

# 26. HOME WORKOUT

Support:

* exercise sequence
* sets
* repetitions
* timers
* rest
* workout plans
* progress

Everything must work offline.

---

# 27. SPORTS

Support a broad sports catalog.

Include at minimum:

Basketball
Football
Soccer
Volleyball
Baseball
Softball
Rugby
Cricket
Handball
Futsal
Hockey
Tennis
Table Tennis
Badminton
Squash
Pickleball
Boxing
Kickboxing
Muay Thai
MMA
Brazilian Jiu-Jitsu
Judo
Karate
Taekwondo
Wrestling
Swimming
Diving
Surfing
Paddleboarding
Kayaking
Canoeing
Rowing
Water Polo
Hiking
Trail Running
Rock Climbing
Skateboarding
Rollerblading
Golf
Archery
Bowling
Darts
Gymnastics
Athletics
Fencing
Skiing
Snowboarding

Allow custom sports.

Sport metrics must be configurable.

---

# 28. HYDRATION

Track:

* amount
* daily target
* history
* reminders
* units

Support:

ml
L
oz

---

# 29. NUTRITION

Allow manual food tracking.

Support:

* calories
* protein
* carbohydrates
* fat
* fiber
* meals
* serving sizes

Do not require an online food database.

---

# 30. SLEEP

Track:

* bedtime
* wake time
* duration
* quality
* notes

Health integrations remain optional.

---

# 31. PRODUCTIVITY

Implement:

* tasks
* priorities
* focus
* Pomodoro
* custom timers
* daily planning
* reviews

Timers must survive:

* backgrounding
* screen lock
* app suspension
* app reopening

Do not rely only on an in-memory timer.

---

# 32. JOURNAL

Implement:

* entries
* mood
* tags
* search
* favorites
* attachments
* privacy lock
* export

Keep journal data local by default.

---

# 33. FINANCE

Implement:

* accounts
* income
* expenses
* transactions
* categories
* budgets
* reports

Never use unsafe floating-point calculations for money.

Use a safe monetary representation.

---

# 34. NOTIFICATIONS

Support local notifications.

Handle platform differences.

Test:

* permission granted
* permission denied
* notification cancelled
* app closed
* device restarted
* timezone changed
* duplicate scheduling

Never assume notification permission exists.

---

# 35. OFFLINE-FIRST

Offline is a CORE requirement.

Test with:

* airplane mode
* Wi-Fi disabled
* mobile data disabled
* server unavailable

Core functionality must remain operational.

---

# 36. OFFLINE QUEUE

When remote synchronization eventually exists:

Local change
↓
Local database
↓
Outbox
↓
Sync worker
↓
Remote service

Never:

Remote API
↓
UI
↓
Nothing local

That architecture is prohibited for core features.

---

# 37. SYNC

Sync is optional.

If sync fails:

DO NOT:

* delete local data
* revert user work
* lock the application
* show endless blocking errors

Instead:

* retain local changes
* retry
* expose sync status
* resolve conflicts deterministically

---

# 38. BACKUP

Backup:

* SQLite data
* settings
* metadata
* user-created records
* reading progress

Validate backups before restore.

Never overwrite current data until the replacement has been validated.

---

# 39. UPDATE SYSTEM

Every release needs:

* semantic version
* build number
* release notes
* database migration version

Test:

Version N
↓
Version N+1

and verify:

* books remain
* reading progress remains
* habits remain
* workouts remain
* goals remain
* journal remains
* finance remains
* settings remain

---

# 40. UI/UX

The application should feel like a premium native mobile application.

Use:

* clear hierarchy
* native interaction patterns
* sheets
* gestures
* accessible controls
* restrained cards
* useful animations
* haptics where appropriate

Avoid:

* excessive gradients
* excessive rounded cards
* clutter
* tiny buttons
* excessive animation
* desktop-style interfaces

---

# 41. DESIGN SYSTEM

Centralize:

* colors
* typography
* spacing
* radii
* shadows
* icons
* motion

Never scatter arbitrary values throughout the codebase.

Support:

* Light
* Dark
* System

---

# 42. ACCESSIBILITY

Test:

* VoiceOver
* Android TalkBack
* Dynamic Type
* Android font scaling
* contrast
* focus order
* labels
* touch target sizes
* reduced motion

Do not communicate state using color alone.

---

# 43. PERFORMANCE

Monitor:

* startup
* memory
* rendering
* database queries
* scrolling
* PDF loading
* image loading

Use:

* virtualization
* pagination
* lazy loading
* memoization
* indexed queries

Do not load an entire large library or PDF unnecessarily.

---

# 44. SECURITY

Audit:

* secrets
* tokens
* API keys
* filesystem access
* permissions
* logs
* exported data
* dependencies
* network requests

Never put secrets in source control.

---

# 45. PRIVACY

Default behavior:

LOCAL FIRST.

Do not send:

* journals
* finance data
* books
* PDFs
* private notes

to remote services unless the user explicitly enables a feature requiring it.

---

# 46. ERROR HANDLING

Every important operation must have failure handling.

Never silently swallow exceptions.

Every failure should:

1. preserve data
2. log technical details safely
3. provide a useful user-facing state
4. provide recovery where possible

---

# 47. TEST THE BAD CASES

Do not only test successful flows.

For every feature ask:

"What happens if the user..."

* taps twice?
* enters invalid data?
* closes the app?
* loses internet?
* runs out of storage?
* denies permission?
* changes timezone?
* changes device time?
* uses dark mode?
* increases font size?
* deletes a file?
* upgrades the application?
* restores old data?

Then test it.

---

# 48. CHAOS TESTING

Before production intentionally break the application.

Simulate:

* network failure
* slow network
* database errors
* missing files
* corrupted files
* interrupted writes
* app termination
* permission denial
* insufficient storage
* invalid user input
* duplicate actions
* concurrent operations

The goal is to discover failures before users do.

---

# 49. CROSS-PLATFORM TEST MATRIX

Test every critical feature on:

IOS:

* simulator/device

ANDROID:

* emulator/device

At minimum verify:

* install
* onboarding
* navigation
* forms
* keyboard
* back navigation
* dark mode
* accessibility
* database
* offline mode
* PDF import
* PDF reader
* notifications
* biometrics
* backup
* restore
* upgrade

---

# 50. DO NOT FAKE COMPLETION

Never call a feature complete if it only has:

* UI
* mock data
* placeholder buttons
* TODO functions
* fake persistence

For a feature to be complete:

UI
+
DATABASE
+
BUSINESS LOGIC
+
PERSISTENCE
+
ERROR HANDLING
+
OFFLINE
+
TESTS

must work.

---

# 51. NO SILENT TODOs

Search the codebase for:

TODO
FIXME
HACK
TEMP
MOCK
PLACEHOLDER
COMING SOON

Review every occurrence.

Do not leave core functionality disguised as finished.

---

# 52. CODE QUALITY AUDIT

Search for:

* any
* duplicated logic
* giant files
* giant components
* circular dependencies
* hardcoded paths
* hardcoded secrets
* unsafe casts
* unused dependencies
* dead code
* unreachable code
* unnecessary network calls

Fix important issues.

---

# 53. DEPENDENCY AUDIT

Before production:

Check every dependency.

Ask:

* Is it necessary?
* Is it maintained?
* Is it Expo-compatible?
* Is it iOS-compatible?
* Is it Android-compatible?
* Does it require native changes?
* Does it increase app size?
* Does it introduce security risk?

Remove unnecessary dependencies.

---

# 54. DATABASE AUDIT

Check:

* indexes
* foreign keys
* constraints
* uniqueness
* migrations
* transactions
* orphan records
* delete behavior
* performance

Never rely solely on application-level validation for important integrity constraints.

---

# 55. UI AUDIT

Inspect every screen.

Check:

* loading
* empty
* error
* success
* offline
* dark mode
* accessibility
* keyboard
* long text
* small screen
* large screen
* large font

---

# 56. DATA LOSS AUDIT

Ask:

"Can the user lose data?"

Test:

* app killed during save
* app killed during PDF import
* interrupted migration
* failed backup
* failed restore
* failed sync
* storage full
* duplicate submission

Data preservation is more important than convenience.

---

# 57. RELEASE CANDIDATE

Before production:

FREEZE FEATURES.

Then run:

1. full type check
2. lint
3. unit tests
4. integration tests
5. database tests
6. migration tests
7. offline tests
8. PDF tests
9. accessibility audit
10. security audit
11. performance audit
12. iOS build
13. Android build
14. install both builds
15. run critical workflows
16. verify upgrade
17. verify backup
18. verify restore

---

# 58. RELEASE CHECKLIST

Do not release until:

[ ] iOS build succeeds
[ ] Android build succeeds
[ ] TypeScript passes
[ ] Lint passes
[ ] Tests pass
[ ] No critical crashes
[ ] Offline mode works
[ ] SQLite persists
[ ] Migrations work
[ ] PDF import works
[ ] PDF reader works
[ ] Reading progress persists
[ ] Habits persist
[ ] Workouts persist
[ ] Goals persist
[ ] Journal persists
[ ] Finance persists
[ ] Notifications work
[ ] Dark mode works
[ ] VoiceOver works
[ ] TalkBack works
[ ] Permissions are handled
[ ] Backup works
[ ] Restore works
[ ] Upgrade preserves data
[ ] No secrets exist in repository
[ ] Privacy reviewed
[ ] Release notes prepared
[ ] Version updated
[ ] Build number updated

---

# 59. APP STORE / PLAY STORE PREPARATION

Prepare production assets for both platforms.

iOS:

* app name
* bundle identifier
* icon
* screenshots
* description
* privacy information
* permissions descriptions
* release notes

Android:

* application ID
* icon
* screenshots
* description
* privacy information
* permissions
* release notes
* signing configuration

Never commit signing credentials.

---

# 60. PRODUCTION BUILD

Build production versions separately for:

iOS

and

Android.

Verify that production configuration does not accidentally point to:

* development databases
* localhost
* test APIs
* debug services
* local development tunnels

---

# 61. DEVELOPMENT VS PRODUCTION

Clearly separate:

Development
Staging
Production

Never allow a production build to accidentally use development infrastructure.

---

# 62. POST-RELEASE

After release monitor:

* crashes
* startup failures
* database failures
* PDF failures
* notification failures
* performance
* storage issues
* platform-specific failures

Prioritize stability before adding major features.

---

# 63. BUG FIX PROCEDURE

For every bug:

REPRODUCE
↓
ISOLATE
↓
IDENTIFY ROOT CAUSE
↓
FIX
↓
ADD REGRESSION TEST
↓
RUN RELATED TESTS
↓
RUN FULL TESTS
↓
VERIFY IOS
↓
VERIFY ANDROID
↓
DOCUMENT IF NECESSARY

Never fix only the visible symptom.

---

# 64. ARCHITECTURAL DECISIONS

Whenever you make an important decision:

Document:

* problem
* options considered
* selected solution
* reason
* consequences

Update:

MEMORY.md

Do not let important architecture exist only in the AI's temporary context.

---

# 65. DOCUMENTATION SYNCHRONIZATION

Whenever implementation changes:

Update the appropriate documentation.

Examples:

New feature:
FEATURES/*.md

Architecture:
ARCHITECTURE.md

Platform:
PLATFORM_SUPPORT.md

Android:
IOS/ANDROID_IMPLEMENTATION.md

Testing:
TESTING/*

Release:
UPDATES/*

Development rules:
AGENTS.md

---

# 66. SELF-REVIEW

After every major phase ask yourself:

1. What did I assume?
2. What could break?
3. What could lose data?
4. What did I not test?
5. What is platform-specific?
6. What happens offline?
7. What happens during app termination?
8. What happens after an upgrade?
9. What happens with bad input?
10. What happens with insufficient storage?
11. What happens when permissions are denied?
12. What happens with accessibility enabled?
13. What happens on a slower device?
14. What happens with a huge PDF?
15. What happens if the backend disappears?

Fix the important problems before continuing.

---

# 67. QUALITY LOOP

Every implementation cycle must follow:

PLAN
↓
INSPECT
↓
IMPLEMENT
↓
TYPECHECK
↓
TEST
↓
RUN
↓
INTENTIONALLY BREAK
↓
FIX
↓
RETEST
↓
OFFLINE TEST
↓
IOS TEST
↓
ANDROID TEST
↓
ACCESSIBILITY TEST
↓
SECURITY TEST
↓
PERFORMANCE TEST
↓
DOCUMENT
↓
CONTINUE

---

# 68. DO NOT STOP EARLY

Do NOT stop because:

* the screen looks good
* the app launches
* the build succeeds
* the first feature works
* tests pass for one module
* the PDF opens
* iOS works
* Android works

Continue until the current phase is genuinely complete.

---

# 69. WHEN SOMETHING IS IMPOSSIBLE

Do not fake functionality.

If a requested capability is impossible or unavailable:

1. Determine why.
2. Identify supported alternatives.
3. Implement the safest fallback.
4. Document the limitation.
5. Keep the rest of the application functional.

Never create fake behavior that looks real.

---

# 70. USER DATA IS SACRED

Never casually delete or reset:

* database
* books
* journal
* habits
* workouts
* goals
* finance
* reading progress
* settings

Before destructive operations:

BACKUP
→ VERIFY
→ MODIFY
→ VERIFY AGAIN

---

# 71. FINAL DEFINITION OF DONE

LifeOS is production-ready only when:

The application can be installed on iOS.

The application can be installed on Android.

The application works without internet.

User data survives restart.

User data survives updates.

PDF books remain available offline.

Reading progress persists.

Habits persist.

Fitness history persists.

Goals persist.

Journal data persists.

Finance data persists.

Notifications behave correctly.

Permissions are handled.

Accessibility works.

Dark mode works.

Errors are handled.

Backups work.

Restores work.

Database migrations work.

Security has been reviewed.

Performance has been reviewed.

The application has been tested on both platforms.

---

# 72. START NOW

Immediately perform:

STEP 1
Read the complete documentation.

STEP 2
Inspect the actual project.

STEP 3
Inspect dependencies and environment.

STEP 4
Run baseline checks.

STEP 5
Create PROJECT_AUDIT.md.

STEP 6
Fix foundational problems.

STEP 7
Implement the foundation.

STEP 8
Test it.

STEP 9
Continue through every roadmap phase.

STEP 10
Continuously update documentation.

STEP 11
Continuously test iOS and Android.

STEP 12
Perform security, performance, accessibility and data-loss audits.

STEP 13
Create a release candidate.

STEP 14
Test production builds.

STEP 15
Prepare production release.

STEP 16
Perform final production-readiness audit.

STEP 17
Do not stop until the application meets the complete Definition of Done.

---

# FINAL COMMAND

START NOW.

Do not merely tell me what you intend to build.

Inspect the project and documentation.

Then actually build it.

When something breaks, diagnose it and fix it.

When you discover a mistake, correct it and add a regression test.

When you discover an architectural problem, fix the architecture instead of working around it.

When you discover documentation that is wrong, update it.

When you discover an edge case, test it.

When you finish a feature, try to break it.

Continue iteratively until LifeOS is a stable, maintainable, offline-first, cross-platform production application for iOS and Android.

The objective is:

BUILD
→ VERIFY
→ BREAK
→ FIX
→ HARDEN
→ DOCUMENT
→ RELEASE

Do not stop at a prototype.
Do not fake completion.
Do not leave core features as placeholders.

START DEVELOPMENT NOW.
