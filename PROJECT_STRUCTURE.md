# PROJECT STRUCTURE

```text
app/
  _layout.tsx
  (tabs)/
    index.tsx
    habits.tsx
    fitness.tsx
    library.tsx
    goals.tsx
  books/ reader/ workouts/ sports/ journal/ finance/ settings/
src/
  components/ features/ hooks/ services/ stores/
  repositories/ database/ pdf/ sync/ notifications/
  theme/ types/ utils/ constants/
assets/
tests/
```

## Feature isolation
Each major feature owns its screens, components, hooks, types and use-cases.
Cross-feature behavior goes through services or shared domain types.

## Naming
Use descriptive PascalCase components, camelCase functions and kebab-free route semantics where Expo Router requires path names.

## No giant files
Split screens when they exceed reasonable complexity. Keep database, UI and network logic separate.