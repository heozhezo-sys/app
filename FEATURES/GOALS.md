# GOALS

Status: **implemented and tested** (Phase 6). See `DEVELOPMENT/PROJECT_STATUS.md`.

Goals support short, medium and long-term objectives.

Goal → milestones → tasks → habits → metrics.

Types: fitness, health, education, career, finance, relationships, personal, reading,
productivity and custom.

Support target/current values, deadlines, notes and progress history.

Progress is derived from completed milestones and recorded metrics where possible.

Show active, completed, paused and archived goals.

Connect goals to Today without forcing users to use every feature.

## How this is implemented

- **Lifecycle.** `active`, `paused`, `completed`, `cancelled`, `archived`. Legal moves
  live in one pure table (`src/services/stateTransitions.ts`, ADR-0011). A status meaning
  finished is only reversible through `archived`, so reopening cannot erase the fact that
  it finished. The goal screen renders its buttons straight from that table, so the UI
  cannot offer a move the domain would reject.
- **Progress.** `progress_pct` is a cache recomputed from milestones after every
  milestone change (ADR-0012). A manual percentage is accepted only while a goal has no
  milestones, and is then refused with an explanation rather than silently overwritten.
- **Tasks.** Attach to a goal, to a milestone, or to neither. Ordered by priority then
  planned date; capped at 200 rows per read. A task cannot reference a milestone from a
  different goal.
- **Today.** Today's tasks plus anything still open from an earlier day appear on the
  Today dashboard, capped at five, with overdue stated in words rather than colour.
- **History.** Goals, milestones and tasks all soft delete. Logs and rows survive.