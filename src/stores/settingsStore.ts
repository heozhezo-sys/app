/**
 * App-wide settings state.
 *
 * Settings are read once after the database opens and kept in a Zustand store so the
 * theme and every screen share one consistent value without re-querying per render.
 */

import { create } from 'zustand';

import * as repository from '@/repositories/settingsRepository';
import { CHANNELS, subscribe } from '@/database/database';
import { DEFAULT_SETTINGS, type Settings } from '@/types/settings';

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,

  load: async () => {
    const settings = await repository.getSettings();
    set({ settings, loaded: true });
  },

  update: async (patch) => {
    // Optimistic: the UI reflects the change immediately, and a failure is corrected
    // by reloading from the database rather than leaving the UI lying.
    const previous = get().settings;
    set({ settings: { ...previous, ...patch } });
    try {
      const saved = await repository.updateSettings(patch);
      set({ settings: saved });
    } catch (error) {
      set({ settings: previous });
      throw error;
    }
  },
}));

/** Subscribes a component to settings changes without pulling in the whole store. */
export function useSettings(): Settings {
  return useSettingsStore((state) => state.settings);
}

/** Called once at app start to keep the store in sync with the database. */
export function startSettingsSync(): () => void {
  return subscribe(CHANNELS.settings, () => {
    void useSettingsStore.getState().load();
  });
}
