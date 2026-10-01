/**
 * Focus feature hooks.
 *
 * The timer is driven by a wall-clock deadline, not by counting ticks in an interval.
 * The interval here only decides *when to re-render*; the remaining time is always
 * recomputed from `endsAt`, so a throttled, delayed or skipped tick cannot make the
 * timer drift. When the app returns to the foreground the clock is re-read immediately.
 */

import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { CHANNELS } from '@/database/database';
import { useAction, useAsyncResource } from '@/hooks/useAsyncResource';
import * as service from '@/services/focusService';
import type { FocusSession } from '@/repositories/focusRepository';
import type { TimerSnapshot } from '@/focus/timerMath';
import { formatCountdown } from '@/focus/timerMath';

/**
 * The active session, re-read on a tick and whenever the app returns to the foreground.
 *
 * One second is a *rendering* cadence, not a source of truth. The interval only decides
 * when to re-read; the remaining time is always recomputed from `endsAt`, so a throttled,
 * delayed or skipped tick cannot make the timer drift.
 */
export function useActiveFocus() {
  const resource = useAsyncResource(() => service.getActiveView(), CHANNELS.focus);

  useEffect(() => {
    const timer = setInterval(() => {
      void resource.refresh();
    }, 1000);

    const onAppStateChange = (status: AppStateStatus): void => {
      // The clock may have moved a long way while backgrounded; re-read on return so the
      // first frame after reopening is already correct.
      if (status === 'active') void resource.refresh();
    };
    const subscription = AppState.addEventListener('change', onAppStateChange);

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
    // `refresh` is stable; depending on it alone would restart the interval every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return resource;
}

export function useStartFocus() {
  return useAction(async (input: Parameters<typeof service.startSession>[0] = {}) =>
    service.startSession(input),
  );
}

export function useCompleteFocus() {
  return useAction((id: string) => service.completeSession(id));
}

export function useAbandonFocus() {
  return useAction(async (id: string) => {
    await service.abandonSession(id);
  });
}

export function useFocusTotals() {
  return useAsyncResource(() => service.todayTotals(), CHANNELS.focus);
}

export function useFocusHistory(limit = 10) {
  return useAsyncResource(() => service.listSessions({ limit }), CHANNELS.focus);
}

export function useTodayReview() {
  return useAsyncResource(() => service.getReview('daily'), CHANNELS.focus);
}

export function useSaveReview() {
  return useAction((input: Parameters<typeof service.saveReview>[0]) => service.saveReview(input));
}

/**
 * Resolves an interrupted session on launch.
 *
 * Runs once, after the database is open. Without it, a session left `active` by a
 * process kill blocks every future timer through the single-active-session rule.
 */
export function useRecoverStaleFocus(enabled: boolean): void {
  const done = useRef(false);

  useEffect(() => {
    if (!enabled || done.current) return;
    done.current = true;
    void service.recoverStaleSession();
  }, [enabled]);
}

export { formatCountdown };
export type { FocusSession, TimerSnapshot };
