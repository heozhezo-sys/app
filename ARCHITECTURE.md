# ARCHITECTURE

```text
UI / Screens
    ↓
Feature hooks / view models
    ↓
Use cases / services
    ↓
Repositories
    ↓
SQLite + filesystem
```

## Layers
- `app/`: Expo Router screens and navigation.
- `src/components/`: shared UI.
- `src/features/`: feature-specific UI and logic.
- `src/services/`: business operations, notifications, PDF and sync.
- `src/repositories/`: storage access.
- `src/database/`: schema and migrations.
- `src/stores/`: transient/application state.
- `src/pdf/`: PDF engine abstraction.
- `src/theme/`: design tokens.

## Data rule
Historical events are the source of truth. Derive totals from logs/sessions where practical.

## Files
PDFs and large media are filesystem assets. SQLite stores metadata, references and indexes.

## Sync
A future sync service consumes a local outbox. Network failure never invalidates local writes.