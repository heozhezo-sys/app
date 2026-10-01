# CODING STANDARDS

## TypeScript

- `strict: true`, plus `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`.
- No `any`. When a type is genuinely unknown at a boundary, use `unknown` and narrow.
- `npm run typecheck` must pass with zero errors before any change is considered done.

## Layers

```
UI (app/, src/features/*/components)
  -> hooks (src/features/*/hooks, src/hooks)
    -> services (src/services)      business rules, validation
      -> repositories (src/repositories)   SQL, row <-> domain mapping
        -> database (src/database)    driver, migrations
```

- Screens never import from `src/database` or write SQL.
- Repositories never contain business rules.
- Cross-feature access goes through services or shared domain types.

## Data rules

- Historical events are the source of truth; derive totals. Never store a counter that
  can disagree with the rows it summarises.
- Money is integer minor units. Never a float.
- Calendar days are local `YYYY-MM-DD`. Never derive a day with `toISOString()`.
- Soft delete (`deleted_at`) for user-visible deletes. Hard delete only inside an
  explicit, confirmed erase flow.
- Schema changes require a new migration. Released migrations are immutable.

## Code quality

- Small modules, single responsibility. Split a screen when it grows past the point of
  comfortable review.
- Validate external input at the service boundary, not only in the UI.
- Never swallow an exception silently. Log it and surface a usable state.
- No hidden network calls. LifeOS is offline-first; a core feature must not need one.
- Name things descriptively; avoid premature abstraction.

## Accessibility

- Touch targets are at least 48pt (`MIN_TOUCH_TARGET`).
- Every interactive element has a role, a label, and a hint where the action is not
  obvious from the label.
- Never communicate state with colour alone — pair it with a glyph, a strike-through,
  and the correct `accessibilityState`.
- Font scaling stays enabled; the multiplier is capped at `MAX_FONT_SCALE`.

## Tests

- Business logic is testable without rendering UI.
- Every bug fix lands with a regression test (see `DEVELOPMENT/CHANGELOG.md`).
- `npm test`, `npm run typecheck` and `npm run lint` must all pass before delivery.
