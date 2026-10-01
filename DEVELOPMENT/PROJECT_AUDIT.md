# PROJECT AUDIT — PHASE 0

Date: 2026-01-10
Scope: full inspection of `D:\lab\applications\LifeOS` before any implementation.

---

## 1. Headline finding

**The LifeOS repository contained no application code at the start of this session.**

Verified by recursive file enumeration:

- Total files: **69**
- Total size: **0.07 MB**
- Source files (`.ts`/`.tsx`/`.js`/`.jsx`): **0**
- `package.json`: **absent**
- Lockfile: **absent**
- `node_modules`: **absent**
- `.git` directory: **absent** (`git status` -> `fatal: not a git repository`)
- Tests: **0**
- Database / migrations: **0**
- Native projects (`android/`, `ios/`): **absent**

Every one of the 69 files is Markdown documentation.

### Consequence

The documentation describes an application that does not exist. The specification in
`START_DEVELOPMENT_TO_PRODUCTION.md` is therefore not a set of *deltas* to apply to an
existing codebase — it is a greenfield build plan. Documentation written in the present
tense ("LifeOS is local-first", "`src/repositories/`", "Core tables: ...") describes
intent, not verified implementation.

Per `AGENT_KNOWLEDGE_PROTOCOL.md`, actual source outranks documentation. Until code
exists, **every architectural statement in the documentation is an assumption**, not a
verified fact. This is the single most important audit result.

---

## 2. Environment inspection

Inspected, not assumed.

| Item | Verified value |
|---|---|
| Node.js | v22.23.0 |
| npm | 12.0.1 |
| npx | 12.0.1 |
| git | 2.53.0.windows.2 |
| Python | 3.12.0 |
| npm registry | `https://registry.npmjs.org/` (reachable) |
| Android SDK | Present at `C:\Users\Razhil\AppData\Local\Android\Sdk` |
| Android Studio | Present at `C:\Program Files\Android\Android Studio` |
| `adb` on PATH | **Not present** |
| macOS / Xcode / CocoaPods | **Unavailable — build host is Windows** |

### Consequence (critical constraint)

**iOS cannot be built, installed, or device-verified from this machine.** Windows has no
Xcode, no iOS Simulator, and no `expo run:ios`. Every iOS verification item in
`START_DEVELOPMENT_TO_PRODUCTION.md` (sections 13, 49, 57, 58) is therefore *structurally
impossible* in this environment.

Per section 69 ("When something is impossible"), this is documented as a hard limitation
rather than faked. iOS support is implemented as first-class, platform-neutral shared code
and iOS-only native paths are guarded at compile time, but **no claim of iOS runtime
verification is made anywhere in this project.**

---

## 3. Documentation vs. reality

| Area | Documentation claims | Actual state | Resolution |
|---|---|---|---|
| Architecture layers | `src/repositories`, `src/services`, `src/database` | Absent | Implemented during Phase 1/2 per this contract |
| Database tables | 26 named tables in `DATA/DATABASE_SCHEMA.md` | No DB, no migrations | Implemented as real versioned migrations |
| Navigation | Expo Router, tabs Today/Habits/Fitness/Library/Goals | Absent | Implemented |
| Persistence | SQLite is source of truth | Absent | `expo-sqlite` behind a driver interface |
| Large files | PDFs on filesystem | Absent | Implemented via storage adapter |
| Tech stack | Expo, TS, Expo Router, Zustand, TanStack Query, Reanimated | No dependencies declared | Expo SDK 57 + RN 0.87 pinned |
| Tests | "unit, integration and end-to-end" | Zero tests | Jest + node:sqlite-backed migration tests |
| Offline queue | `sync_queue` outbox | Absent | Schema + repository implemented; sync transport intentionally not implemented |

### Documentation defects found (and corrected this session)

1. `ROADMAP/ROADMAP.md`, `DATA/DATABASE_SCHEMA.md`, `TESTING/TEST_STRATEGY.md`,
   `CHECKLISTS/MASTER_CHECKLIST.md` and `DEVELOPMENT/CODING_STANDARDS.md` were written
   with **literal backtick-n escape sequences** instead of real newlines, rendering each
   file as a single unreadable line. Corrected to real markdown.

2. `TECH_STACK.md` mandates TanStack Query for "optional remote data". LifeOS has **no
   remote service** and is explicitly offline-only for core features. Adding a remote-data
   caching library would be unused dependency weight. Decision recorded as ADR-0004.

3. `ARCHITECTURE.md` lists `src/pdf/` as "PDF engine abstraction" but no engine is
   chosen. PDF rendering requires a native module. The abstraction boundary plus a real
   engine are resolved at build time. Recorded as ADR-0006.

4. `MASTER_CHECKLIST.md` ended with a stray apostrophe
   (`[ ] Release build tested on physical iPhone'`), indicating the file was authored
   incomplete.

5. No document stated the current build host or that iOS verification is impossible on
   Windows. That constraint is now recorded in `PLATFORM_SUPPORT.md` and
   `TESTING/CROSS_PLATFORM_TESTING.md`.

---

## 4. Risk register

| ID | Risk | Severity | Mitigation implemented |
|---|---|---|---|
| R-01 | Greenfield build exceeds session capacity; partial app shipped as "complete" | critical | `BASELINE.md` and `PROJECT_STATUS.md` separate **verified** from **not implemented**; no phase is marked done without a passing command |
| R-02 | Migrations silently destroy user data | critical | Every migration runs in a transaction; `user_version` only advances on success; pre-migration backup hook; migrations tested against real SQLite |
| R-03 | Floating-point money in Finance | high | Integer minor-unit (`cents`) arithmetic; no float in money paths |
| R-04 | iOS-only implementation leaking into shared code | high | Native access confined to `src/platform/*` adapters returning capability results; shared code has no platform branches |
| R-05 | Timers lost on background/termination | high | Focus timers store wall-clock `endsAt`, never tick counts; elapsed time recomputed from the clock |
| R-06 | PDF binary stored in SQLite | high | Only metadata in SQLite; binary in app storage via storage adapter |
| R-07 | Secrets committed | high | `.env*` git-ignored; no secret read from source; SecureStore for lock state |
| R-08 | Untestable migrations | medium | `node:sqlite` (Node 22 built-in) executes the *same* migration SQL in unit tests |
| R-09 | Large datasets blocking UI | medium | Paginated repository reads, indexed columns, subscription-based invalidation |

---

## 5. Technical debt at start

None — there is no code. The debt being taken on is architectural, and is recorded in
`DEVELOPMENT/DECISIONS.md` as ADRs so it is not silently repeated by future sessions.

---

## 6. Architecture conflicts found in the spec

1. **"Test on iOS" vs. Windows build host.** Sections 49/57/58/71 require iOS device
   verification. Unachievable here. Documented, not faked.
2. **"Continuous scroll where supported" PDF mode** (section 20) depends entirely on the
   chosen engine's capabilities. The `PDFReaderEngine` interface reports capability flags
   per document so unsupported combinations render explicit "unsupported" UI rather than a
   control that silently does nothing.
3. **Highlight/search support** is PDF-format dependent, not app dependent. The same
   capability-flag mechanism handles it.

---

## 7. Recommended fixes carried into implementation

1. Scaffold Expo SDK 57 + TypeScript strict + Expo Router as the single source of truth.
2. Put SQL behind a `SqlDriver` interface so identical migration SQL is exercised by real
   SQLite in tests and by `expo-sqlite` on device.
3. Implement money as integer minor units.
4. Implement timers as wall-clock deadlines.
5. Confine every native API behind an adapter returning `{ supported, reason?, value }` —
   never throwing for unavailability.
6. Track verified vs. unverified work explicitly in `PROJECT_STATUS.md`.

---

## 8. Verdict

The repository is a well-structured **specification**, not a project. The specification is
internally coherent and unusually detailed. The gap between it and reality is total.

Implementation therefore proceeds phase by phase from the documented contract, and every
claim of completion in this repository is gated on a command that was actually run and
actually passed.
