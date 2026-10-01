# MASTER CHECKLIST

Honest state as of 2026-01-10. See `DEVELOPMENT/PROJECT_STATUS.md` for the full
ledger and for what is explicitly *not* implemented.

## Verified (command run, passed)

- [x] Architecture implemented (UI -> hooks -> services -> repositories -> SQLite)
- [x] Navigation structure and entry gate
- [x] Local database and migrations tested against real SQLite
- [x] Schema integrity constraints verified by direct-SQL tests
- [x] Offline behaviour by construction: no core feature makes a network call
- [x] Habit CRUD, completion, undo, archive, restore, history, statistics
- [x] Goal lifecycle with an enforced state machine; milestones and tasks
- [x] Today's and overdue tasks on the Today dashboard
- [x] Workouts, sets, body metrics and derived personal records
- [x] 43 exercises and 47 sports seeded; custom sports supported
- [x] TypeScript passes (`npm run typecheck`)
- [x] Lint passes (`npm run lint`, zero warnings)
- [x] 222 tests pass across 10 suites (`npm test`)

## Implemented, not device-verified

- [ ] Design system verified on a real iOS screen
- [ ] Design system verified on a real Android screen
- [ ] Dark mode verified on device
- [ ] Dynamic Type / font scaling verified on device
- [ ] VoiceOver pass
- [ ] TalkBack pass
- [ ] Android back navigation pass
- [ ] Metro production bundle build

## Not started

- [ ] PDF library and reader
- [ ] Productivity, focus timer, calendar
- [ ] Sleep, hydration, nutrition
- [ ] Journal
- [ ] Finance
- [ ] Analytics and achievements
- [ ] Notifications
- [ ] Backup and restore
- [ ] Full security audit (partial: see `SECURITY/SECURITY.md`)
- [ ] Performance audit
- [ ] Upgrade migration verified on a real device (N -> N+1)

## Blocked by the environment

- [ ] Release build tested on a physical iPhone — **impossible on this Windows host**
- [ ] Release build tested on an Android device — `adb`/emulator not provisioned

## Release gate

Do not ship until every unchecked item above is either completed or explicitly waived
in writing. The iOS device pass cannot be completed on this host at all; it requires
macOS with Xcode, and it is recorded as a hard limitation rather than quietly marked
complete.
