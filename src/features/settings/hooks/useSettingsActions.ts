/**
 * Settings and data-safety hooks.
 *
 * Backup, restore, the journal lock and reminders all live behind Settings because
 * they are about the user's data rather than about a day's activity. Screens use these
 * hooks and never the services directly.
 *
 * Restore is the one operation here that can destroy data, so its hook surfaces the
 * typed `RestoreResult` rather than an exception: the caller has to say what happened.
 */

import { CHANNELS } from '@/database/database';
import { useAction, useAsyncResource } from '@/hooks/useAsyncResource';
import { useSettings, useSettingsStore } from '@/stores/settingsStore';
import * as backupService from '@/services/backupService';
import * as journalExportService from '@/services/journalExportService';
import * as notificationService from '@/services/notificationService';
import type { Settings } from '@/types/settings';

/* --------------------------------------------------------------- settings */

/**
 * Persists a settings patch.
 *
 * The store updates optimistically and rolls back if the write fails, so the UI stays
 * truthful either way.
 */
export function useUpdateSettings() {
  return useAction((patch: Partial<Settings>) => useSettingsStore.getState().update(patch));
}

/** Subscribes to the current settings without pulling in the whole store. */
export function useSettingsValue(): Settings {
  return useSettings();
}

/* ----------------------------------------------------------------- backup */

export function useExportBackup() {
  return useAction(() => backupService.exportBackup());
}

export function useRestoreBackup() {
  return useAction((json: string) => backupService.restoreBackup(json));
}

/**
 * The restore controls for one screen: restore, undo, and whether undo is available.
 *
 * `canUndoRestore()` is synchronous session state rather than a table, so the screen asks
 * again after every restore instead of subscribing to a channel. Reading it during render
 * is deliberate: the value can only change as a result of a restore or undo performed from
 * this same screen, and both of those re-render it.
 */
export function useRestoreControls() {
  const restore = useRestoreBackup();
  const undo = useAction(() => backupService.undoLastRestore());
  return { canUndo: backupService.canUndoRestore(), restore, undo };
}

/**
 * Inspects a backup without restoring, for the confirmation step.
 *
 * `summarise` is synchronous and returns `null` for a file it cannot parse, so it is
 * wrapped rather than being read during render — parsing a full document on every render
 * would be wasteful, and the failure is a value here rather than an exception.
 */
export function useInspectBackup() {
  return useAction(async (json: string) => backupService.summarise(json));
}

/* -------------------------------------------------------- journal exports */

/** Exports previously written journal files. Not database-derived; read from storage. */
export function useJournalExports() {
  return useAsyncResource(() => journalExportService.listExports(), CHANNELS.journal);
}

export function useExportJournal() {
  return useAction(
    (options: { format: Parameters<typeof journalExportService.exportJournal>[0]['format']; filters?: Parameters<typeof journalExportService.exportJournal>[0]['filters'] }) =>
      journalExportService.exportJournal({
        ...options,
        today: todayKeyOf(),
      }),
  );
}

export function useDeleteJournalExport() {
  return useAction((filePath: string) => journalExportService.deleteExport(filePath));
}

/* ------------------------------------------------------------ journal lock */

/**
 * Lock state for the journal gate and the Settings switch.
 *
 * Subscribes to `journal` so it re-reads when entries change, and refreshes explicitly
 * after an unlock because the unlocked flag is deliberately in memory rather than in
 * the database (see `journalExportService`).
 */
export function useJournalLock() {
  const enabled = useSettings().journalLockEnabled;
  const state = useAsyncResource(() => journalExportService.lockState(enabled), CHANNELS.journal, {
    deps: [enabled],
  });
  const unlock = useAction(() => journalExportService.unlockJournal());
  const relock = useAction(async () => {
    journalExportService.lockJournal();
    await state.refresh();
  });

  return { ...state, enabled, unlock, relock };
}

/* ------------------------------------------------------------- reminders */

/** OS permission state, for the Settings copy and the "allow" action. */
export function useNotificationStatus() {
  return useAsyncResource(() => notificationService.status(), CHANNELS.settings);
}

export function useRequestNotificationPermission() {
  return useAction(() => notificationService.requestPermission());
}

export function useEnabledReminders() {
  return useAsyncResource(() => notificationService.listEnabled(), CHANNELS.settings);
}

export function useCancelReminder() {
  return useAction((id: string, repeat?: boolean) => notificationService.cancel(id, repeat));
}

/** Re-arms every upcoming reminder, for the "after an app update" case. */
export function useRehydrateReminders() {
  return useAction(() => notificationService.rehydrate());
}

/** Today as a local `YYYY-MM-DD`, computed once per render. */
function todayKeyOf(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}