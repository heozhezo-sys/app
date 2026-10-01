/**
 * Journal feature hooks.
 *
 * Screens never touch the repository; they use these, so the use-case layer stays the one
 * place that knows what a valid entry is.
 */

import { useCallback, useState } from 'react';

import { CHANNELS } from '@/database/database';
import { useAction, useAsyncResource } from '@/hooks/useAsyncResource';
import * as service from '@/services/journalService';
import type { JournalEntry } from '@/repositories/journalRepository';
import type { SearchStrategy } from '@/journal/search';
import { todayKey, type DateKey } from '@/utils/dates';

export type JournalFilter = 'all' | 'favorites';

/**
 * Entries for the list, or `favorites`.
 *
 * `enabled` exists for the journal lock: entries are not *fetched* while the journal is
 * hidden, rather than fetched and hidden. A preview that arrives one frame after the gate
 * is exactly what a lock has to prevent.
 */
export function useJournalEntries(
  filter: JournalFilter = 'all',
  limit = 30,
  enabled = true,
) {
  return useAsyncResource(
    async () =>
      filter === 'favorites' ? service.listFavorites() : service.listEntries({ limit }),
    CHANNELS.journal,
    { enabled, deps: [filter, limit] },
  );
}

/**
 * Search state.
 *
 * The strategy is carried alongside the results so a screen can say it fell back to the
 * slower path, rather than implying the indexed one ran.
 *
 * `enabled` is the same journal-lock gate as {@link useJournalEntries}: a search must not
 * run against a locked journal either, because its results are entry content.
 */
export function useJournalSearch(query: string, enabled = true) {
  const [strategy, setStrategy] = useState<SearchStrategy | null>(null);

  const resource = useAsyncResource(
    async () => {
      const result = await service.search(query);
      setStrategy(result.strategy);
      return result.entries;
    },
    CHANNELS.journal,
    { enabled: enabled && query.trim() !== '', deps: [query, enabled] },
  );

  return { ...resource, strategy };
}

export function useCreateEntry() {
  return useAction((input: Parameters<typeof service.createEntry>[0]) =>
    service.createEntry(input),
  );
}

export function useEditEntry() {
  return useAction((id: string, input: Parameters<typeof service.editEntry>[1]) =>
    service.editEntry(id, input),
  );
}

export function useToggleFavorite() {
  return useAction((id: string) => service.toggleFavorite(id));
}

export function useDeleteEntry() {
  return useAction((id: string) => service.deleteEntry(id));
}

export function useAttachments(entryId: string | null) {
  return useAsyncResource(
    async () => (entryId ? service.listAttachments(entryId) : []),
    CHANNELS.journal,
    { enabled: entryId !== null, deps: [entryId] },
  );
}

/** Today, from the device clock. */
export function useToday(): DateKey {
  const getToday = useCallback(() => todayKey(new Date()), []);
  return getToday();
}

export type { JournalEntry };
