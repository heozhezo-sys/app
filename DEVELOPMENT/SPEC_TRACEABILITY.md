# SPECIFICATION TRACEABILITY

Which code satisfies which line of the specification.

The `.md` files under `FEATURES/`, `BOOKS/`, `DATA/`, `OFFLINE/`, `SECURITY/`, `TESTING/`
and `UI_UX/` are **requirements**. They are not edited to match the code — a spec that has
been rewritten to agree with the implementation is no longer a spec. This file is the join
between the two, so a reader can check a requirement against the code that claims to meet
it.

Last reviewed: 2026-10-01. Verified against **1017 tests / 36 suites, schema v15**.

Status values:

- **met** — implemented and covered by a test.
- **met (not device-verified)** — implemented; never run on hardware (see ISSUE-002).
- **by design** — deliberately absent, and the requirement it relates to permits it.
- **partial** — some of the requirement is met; the gap is named.

---

## FEATURES/*.md

| Spec | Requirement | Status | Implementation |
|---|---|---|---|
| ACHIEVEMENTS.md | Milestones: first habit, streaks, workouts, books, reading time | met | `src/achievements/catalogue.ts`, `achievementsService.ts` |
| ACHIEVEMENTS.md | Track unlocked state and unlock date | met | `achievement_unlocks`, `insertUnlock` |
| ACHIEVEMENTS.md | Allow users to disable gamification | met | `Settings.gamificationEnabled`, `app/achievements.tsx` |
| ACHIEVEMENTS.md | Informational and supportive | met | No score, no rank, no penalty anywhere |
| ANALYTICS.md | Show trends over time | met | `src/analytics/periods.ts`, `analyticsService.ts`, `app/analytics.tsx` |
| ANALYTICS.md | Periods: daily, weekly, monthly, yearly | met | `PERIOD_TYPES`, all four offered |
| CALENDAR.md | Day, week and month views | met | `calendarService.ts`; rolling 28-day window, `app/calendar.tsx` |
| CALENDAR.md | Aggregate across habits, goals, workouts, health, journal, finance | met | `CALENDAR_KINDS`, `timeline()` |
| CYCLING.md / RUNNING.md / SWIMMING.md | Sport sessions | met | `sport_sessions`, one activity architecture (ADR-0013) |
| DASHBOARD.md | Today as the command centre | met | `app/(tabs)/index.tsx` |
| FEATURES_MASTER.md | Mobility, stretching, yoga, recovery | met | `src/health/mobilityMath.ts`, migration 013 |
| FINANCE.md | Track income, expenses, savings, accounts, budgets | met | `financeService.ts`, `app/(tabs)/finance.tsx` |
| FINANCE.md | Transactions: amount, category, date, account, notes | met | `finance_transactions` |
| FINANCE.md | Support PHP, USD, EUR and custom currencies | met | `CURRENCY_PRESETS` plus any ISO-4217 code |
| FINANCE.md | Keep finance records local by default | met | No transport; asserted by test |
| FINANCE.md | Budgets | met | `budgetState`, `budgetProgress`, set and remove in the UI |
| FITNESS.md | Workouts, sets, exercises, body metrics | met | `tests/integration/fitness.test.ts` |
| FOCUS.md / PRODUCTIVITY.md | Focus timer, presets, reviews | met | `tests/integration/focus.test.ts` |
| GOALS.md | Goals, milestones, tasks, state machine | met | `tests/integration/goals.test.ts`, ADR-0011/0012 |
| HABITS.md | Habits, cadence, streaks, history | met | `tests/integration/habits.test.ts` |
| HEALTH.md | Sleep, hydration, nutrition | met | `tests/integration/health.test.ts` |
| HYDRATION.md | Water logging with a daily target | met | `water_logs`, `Settings.hydrationTargetMl` |
| JOURNAL.md | Entries, tags, favourites, attachments | met | `tests/integration/journal.test.ts` |
| JOURNAL.md | Never transmit contents silently | met | No network path exists; asserted by test |
| JOURNAL.md | Export | met | `src/journal/export.ts`, md/json/csv, bodies omitted by default |
| NOTIFICATIONS.md | Local reminders, offline | met | `notificationService.ts`, `tests/integration/notifications.test.ts` |
| NUTRITION.md | Foods, meals, macros | met | `nutrition_entries`, integer 4/4/9 |
| RECOVERY.md | Daily ratings and mobility sessions | met | `recoveryService.ts`, `app/recovery.tsx` |
| RECOVERY.md | No medical interpretation | met | Service returns means and spreads only; asserted by test |
| SLEEP.md | Sleep logging with averages | met | `sleepMath.ts` |
| SPORTS.md | Sport catalogue and sessions | met | 47 built-in sports, seeded at runtime (ADR-0015) |
| HOME_WORKOUT.md | Home workouts | met | One activity architecture covers it (ADR-0013) |

## Other directories

| Spec | Requirement | Status | Implementation |
|---|---|---|---|
| OFFLINE/OFFLINE_FIRST.md | All core features work without network | met | Asserted across every screen by `tests/ui/secondaryModules.test.tsx` |
| OFFLINE/LOCAL_DATABASE.md | SQLite, migrations, repositories, transactions, indexes | met | 15 migrations, `SqlDriver`, soft deletes |
| OFFLINE/SYNC_ARCHITECTURE.md | Optional sync only; outbox, no transport | by design | `sync_queue` exists; no transport is written |
| OFFLINE/SYNC_ARCHITECTURE.md | Show sync status | partial | Not surfaced in the UI — there is nothing to sync |
| SECURITY/*.md | Secrets in SecureStore | partial | No secrets exist; the journal lock uses device authentication only |
| SECURITY/*.md | Journal protected | met | Gate, re-locked on blur, never persisted (ADR-0021) |
| SECURITY/*.md | At-rest encryption of the journal | by design | Explicitly **not** claimed; stated in the docs and in the UI |
| TESTING/*.md | Critical workflows tested | met | 1017 tests, two Jest projects, real SQLite |
| TESTING/*.md | Test on iOS and Android | not possible | ISSUE-002; no emulator provisioned |
| UI_UX/UI_UX_SPEC.md | Primary navigation | met | Eleven implemented tabs; ADR-0010 keeps unimplemented ones off the bar |
| UI_UX/NAVIGATION.md | Secondary modules reached via Today, hubs and Settings | met | The hub on `app/(tabs)/index.tsx` plus `app/settings/index.tsx` |
| UI_UX/NAVIGATION.md | Preserve navigation state when returning from a child | met | Expo Router stack; list screens read from the database, not from route params |
| UI_UX/ACCESSIBILITY.md | Dynamic Type, VoiceOver labels, roles, contrast, large targets | met | `MIN_TOUCH_TARGET` 48 everywhere; asserted by `tests/ui/components.test.tsx` |
| UI_UX/ACCESSIBILITY.md | Never use colour as the only state indicator | met | Every toggle passes `selected`; asserted |
| UI_UX/ACCESSIBILITY.md | Support Reduce Motion | met | `Settings.reduceMotionOverride`, `app/settings/appearance.tsx` |
| UI_UX/UI_UX_SPEC.md | Reader hides controls, tap to toggle, swipe, pinch | not implemented | The reader is a scrolling text view; no gesture paging, no pinch-zoom, no control auto-hide |
| DATA/DATABASE_SCHEMA.md | Migrations for every schema change | met | `LATEST_SCHEMA_VERSION` === `MIGRATIONS.length`, asserted |
| BOOKS/PDF_IMPORT.md | Import via picker, validate, never upload, keep the original on failure | met | `pdfImportService.ts`, `.part` then atomic rename, sweep on launch |
| BOOKS/BOOK_LIBRARY.md | Sections, metadata, statuses, search, sort, filters, collections, safe removal | met | `booksService.ts`, `app/(tabs)/books.tsx` |
| BOOKS/READING_PROGRESS.md | Persist page, percentage, sessions; derive totals from sessions | met | ADR-0020 — totals computed on read |
| BOOKS/BOOKMARKS.md | Add, rename, delete, jump, sort, persist | met | `booksRepository.ts` bookmarks |
| BOOKS/BOOK_NOTES.md | Create, edit, search, tag, delete; book-specific and global views | met | `book_notes` |
| BOOKS/HIGHLIGHTS.md | Page-level highlights where the engine exposes text; graceful for scans | met | Stored with book, page, text, colour, timestamp |
| BOOKS/PDF_READER.md | Immersive screen; TOC, bookmarks, highlights, notes, progress | met | `app/book/[id].tsx` shows explicit unsupported states |
| BOOKS/PDF_READER.md | Page navigation, slider, zoom, search | partial | Navigation and progress exist; **text search and zoom do not**, because the engine reports `textSearch: false` |
| BOOKS/PDF_READER.md | Themes: light, dark, sepia, black | not implemented | App themes are light/dark/system; sepia and black reader themes are absent |
| BOOKS/PDF_READER.md | Modes: single page, continuous, two-page landscape | not implemented | No page-mode control in the reader |
| BOOKS/PDF_READER.md | Tap centre toggles controls; gestures navigate and zoom | not implemented | No gesture handling in the reader |
| BOOKS/READING_ANALYTICS.md | Pages, completions, sessions, time, streaks; no health-like claims | met | `booksService.ts` analytics; `books_added`/`reading_minutes` feed achievements |

## Known gaps, stated plainly

1. **No device verification of any kind.** Every row above marked "met" means a command
   passed in this environment.
2. **The PDF reader cannot render pages or search text.** This is deliberate and reported
   to the user as an unsupported state (ADR-0006), and it is why text search, zoom, page
   modes, reader themes and gestures are all unimplemented: they all need a rendering or
   text-layer capability the current engine does not have. Choosing a rasterising engine
   is the single change that unblocks five rows at once.
3. **Recurring transactions** have schema, cadence rules and reminder text, but the finance
   screen does not yet offer a way to create one.
4. **Sync status** has no UI, because no sync transport exists to have a status.
5. **App-level theming is light/dark/system only.** Sepia and black reader themes are
   absent, for the same reason as the row above.
