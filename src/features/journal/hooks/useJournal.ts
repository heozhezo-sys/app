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

export function useJournalEntries(filter: JournalFilter = 'all', limit = 30) {
  return useAsyncResource(
    async () =>
      filter === 'favorites' ? service.listFavorites() : service.listEntries({ limit }),
    CHANNELS.journal,
    { deps: [filter, limit] },
  );
}

/**
 * Search state.
 *
 * The strategy is carried alongside the results so a screen can say it fell back to the
 * slower path, rather than implying the indexed one ran.
 */
export function useJournalSearch(query: string) {
  const [strategy, setStrategy] = useState<SearchStrategy | null>(null);

  const resource = useAsyncResource(
    async () => {
      const result = await service.search(query);
      setStrategy(result.strategy);
      return result.entries;
    },
    CHANNELS.journal,
    { enabled: query.trim() !== '', deps: [query] },
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
