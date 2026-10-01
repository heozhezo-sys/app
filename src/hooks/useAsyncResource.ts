/**
 * Generic async resource hook.
 *
 * LifeOS has no server, so there is no cache to invalidate over a network. A resource
 * is: read from SQLite, re-read when its channel notifies. This hook encapsulates
 * exactly that, including the states every screen must handle (loading, empty, error)
 * and the guarantee that a late-arriving result from a superseded run is discarded.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { subscribe } from '@/database/database';
import { logger } from '@/utils/logger';

export type ResourceState<T> =
  | { status: 'loading'; data: T | null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: T | null; error: Error };

export type AsyncResource<T> = ResourceState<T> & {
  /** Re-reads from the database. */
  refresh: () => Promise<void>;
  /** True while a background refresh runs over already-rendered data. */
  refreshing: boolean;
};

export interface UseAsyncResourceOptions {
  /** Skip loading entirely (e.g. before onboarding). */
  enabled?: boolean;
  /** Extra dependencies that should trigger a reload. */
  deps?: readonly unknown[];
}

export function useAsyncResource<T>(
  load: () => Promise<T>,
  channel: string,
  options: UseAsyncResourceOptions = {},
): AsyncResource<T> {
  const { enabled = true, deps = [] } = options;

  const [state, setState] = useState<ResourceState<T>>({
    status: 'loading',
    data: null,
    error: null,
  });
  const [refreshing, setRefreshing] = useState(false);

  // Monotonic token: only the newest run is allowed to write state.
  const runId = useRef(0);
  const mounted = useRef(true);
  // Keep the latest loader without making it a dependency of the effect. Assigned in
  // an effect, never during render: writing a ref while rendering is unsafe because
  // React may discard the render (Suspense, concurrent rendering).
  const loader = useRef(load);
  /** True once at least one load has settled, initial or not. */
  const hasLoaded = useRef(false);

  useEffect(() => {
    loader.current = load;
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const id = (runId.current += 1);
    // Only flag a refresh when there is already something on screen. The very first
    // load needs no state change because the hook already starts in `loading`, and
    // setting state synchronously in an effect would trigger a cascading render.
    if (hasLoaded.current) setRefreshing(true);
    try {
      const data = await loader.current();
      if (!mounted.current || id !== runId.current) return;
      hasLoaded.current = true;
      setState({ status: 'ready', data, error: null });
    } catch (error) {
      if (!mounted.current || id !== runId.current) return;
      const normalised =
        error instanceof Error ? error : new Error('Something went wrong loading your data');
      logger.error(`Resource "${channel}" failed to load`, normalised);
      hasLoaded.current = true;
      setState((previous) => ({
        status: 'error',
        // Keep showing stale data rather than blanking the screen on a refresh failure.
        data: previous.data,
        error: normalised,
      }));
    } finally {
      if (mounted.current && id === runId.current) setRefreshing(false);
    }
  }, [channel]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, refresh, ...deps]);

  useEffect(() => {
    if (!enabled) return;
    return subscribe(channel, () => {
      void refresh();
    });
  }, [channel, enabled, refresh]);

  return { ...state, refresh, refreshing };
}

/**
 * Wraps a one-shot action (save, toggle, delete) with pending/error state so a screen
 * never has to hand-roll a double-submit guard.
 */
export function useAction<Args extends unknown[], R>(
  action: (...args: Args) => Promise<R>,
): {
  run: (...args: Args) => Promise<R | null>;
  pending: boolean;
  error: Error | null;
  clearError: () => void;
} {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args: Args): Promise<R | null> => {
      // Hard guard against rapid duplicate taps, independent of React render timing.
      if (inFlight.current) return null;
      inFlight.current = true;
      setPending(true);
      setError(null);
      try {
        return await action(...args);
      } catch (caught) {
        const normalised =
          caught instanceof Error ? caught : new Error('Something went wrong');
        logger.error('Action failed', normalised);
        if (mounted.current) setError(normalised);
        return null;
      } finally {
        inFlight.current = false;
        if (mounted.current) setPending(false);
      }
    },
    [action],
  );

  return { run, pending, error, clearError: useCallback(() => setError(null), []) };
}
