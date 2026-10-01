/**
 * Calendar.
 *
 * A projection, not a store: every entry is a `SELECT` across the domain tables and
 * nothing is ever written back. That is why deleting a workout removes it from here with
 * no separate step.
 *
 * The range is a rolling month rather than a month grid. A grid needs either 35 cells of
 * mostly empty space or a lot of layout maths, and neither tells a user more than "here is
 * what I did, in order". Grouped by day, it answers the question the calendar exists for.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, MIN_TOUCH_TARGET, Screen, Section, StateView } from '@/components/Layout';
import {
  CALENDAR_KIND_LABELS,
  MAX_RANGE_DAYS,
  countsByKind,
  dayHeading,
  routeFor,
  useCalendarRange,
  useCalendarUpcoming,
} from '@/features/calendar/hooks/useCalendar';
import type { CalendarEntry } from '@/features/calendar/hooks/useCalendar';
import { useToday } from '@/features/finance/hooks/useFinance';
import { addDays } from '@/utils/dates';
import { useTheme } from '@/theme/ThemeProvider';

/** A fortnight back and a fortnight forward: long enough to be useful, short enough to render. */
const DEFAULT_SPAN = 28;

export default function CalendarScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const today = useToday();

  const [offset, setOffset] = useState(0);

  const from = useMemo(
    () => addDays(today, -Math.floor(DEFAULT_SPAN / 2) + offset * DEFAULT_SPAN),
    [offset, today],
  );
  const to = useMemo(() => addDays(from, DEFAULT_SPAN - 1), [from]);

  const range = useCalendarRange(from, to);
  const upcoming = useCalendarUpcoming(addDays(today, 1), 7);

  const open = useCallback(
    (entry: CalendarEntry) => {
      const route = routeFor(entry);
      // No route means the owning feature has no detail screen. The row stays read-only
      // rather than navigating somewhere that does not exist.
      if (route) router.push(route as never);
    },
    [router],
  );

  const entries = range.data?.ok ? range.data.entries : [];
  const counts = countsByKind(entries);

  /** Days that have something, newest first, so Today is not buried under history. */
  const days = useMemo(() => {
    const map = range.data?.ok ? range.data.byDate : new Map();
    return [...map.entries()]
      .filter(([, items]) => items.length > 0)
      .sort((a, b) => b[0].localeCompare(a[0]));
  }, [range.data]);

  const upcomingDays = useMemo(
    () =>
      [...(upcoming.data ?? new Map())]
        .filter(([, items]) => items.length > 0)
        .sort((a, b) => a[0].localeCompare(b[0])),
    [upcoming.data],
  );

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xl,
        }}
      >
        <AppText variant="display" accessibilityRole="header">
          Calendar
        </AppText>
        <Spacer size="xs" />
        <AppText variant="caption" tone="muted">
          Everything you have recorded, grouped by day. Nothing here is stored separately —
          edit the original and it changes here too.
        </AppText>

        <Spacer size="md" />

        <View style={styles.pager}>
          <Button
            label="Earlier"
            onPress={() => setOffset((current) => current - 1)}
            variant="ghost"
            size="compact"
            accessibilityHint="Show the previous few weeks"
            testID="calendar-earlier"
          />
          <AppText variant="caption" tone="faint">
            {from} to {to}
          </AppText>
          <Button
            label="Later"
            onPress={() => setOffset((current) => current + 1)}
            variant="ghost"
            size="compact"
            disabled={offset >= 0}
            accessibilityHint="Show the next few weeks"
            testID="calendar-later"
          />
        </View>

        <Spacer size="md" />

        {range.status === 'loading' ? (
          <StateView state="loading" loadingLabel="Gathering your days" />
        ) : !range.data?.ok ? (
          <StateView state="error" errorMessage={range.data?.message ?? null} />
        ) : days.length === 0 ? (
          <StateView
            state="empty"
            emptyTitle="Nothing recorded in these weeks"
            emptyBody="Try the arrows to look further back."
          />
        ) : (
          <>
            <Section title="What you have logged">
              <Card flush>
                {Object.entries(counts)
                  .filter(([, count]) => count > 0)
                  .map(([kind, count], index) => (
                    <View key={kind}>
                      {index > 0 && <View style={styles.divider} />}
                      <View style={styles.row}>
                        <AppText variant="body" style={styles.grow}>
                          {CALENDAR_KIND_LABELS[kind as keyof typeof CALENDAR_KIND_LABELS]}
                        </AppText>
                        <AppText variant="caption" tone="muted">
                          {count}
                        </AppText>
                      </View>
                    </View>
                  ))}
              </Card>
            </Section>

            {days.map(([date, items]) => (
              <Section key={date} title={date === today ? 'Today' : dayHeading(date)}>
                <EntryList entries={items} onPress={open} />
              </Section>
            ))}
          </>
        )}

        {upcomingDays.length > 0 ? (
          <Section title="Coming up">
            {upcomingDays.map(([date, items]) => (
              <View key={date} style={{ marginBottom: theme.spacing.md }}>
                <AppText variant="caption" tone="muted">
                  {dayHeading(date)}
                </AppText>
                <Spacer size="xs" />
                <EntryList entries={items} onPress={open} />
              </View>
            ))}
          </Section>
        ) : null}

        <Spacer size="lg" />
        <AppText variant="caption" tone="faint">
          Showing {DEFAULT_SPAN} days at a time, up to {MAX_RANGE_DAYS} in one view.
        </AppText>
      </ScrollView>
    </Screen>
  );
}

/**
 * One day's entries.
 *
 * A row with a destination is pressable and a row without one is not. Rendering both as
 * plain text would lose the navigation, and rendering both as buttons would promise a tap
 * that does nothing.
 *
 * A `Pressable` rather than the shared `Button`, because this row's content is a layout
 * rather than a single label — and because a button whose visible label was synthesised
 * from `label`/`value` would not describe what is actually on screen.
 */
function EntryList({
  entries,
  onPress,
}: {
  entries: readonly CalendarEntry[];
  onPress: (entry: CalendarEntry) => void;
}): React.ReactElement {
  return (
    <Card flush>
      {entries.map((entry, index) => {
        const route = routeFor(entry);
        const spoken = `${CALENDAR_KIND_LABELS[entry.kind]}: ${entry.title}${
          entry.detail ? `, ${entry.detail}` : ''
        }`;

        return (
          <View key={entry.key}>
            {index > 0 && <View style={styles.divider} />}
            {route ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={spoken}
                accessibilityHint="Opens the detail screen for this"
                onPress={() => onPress(entry)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                testID={`calendar-entry-${entry.key}`}
              >
                <AppText variant="caption" tone="muted" style={styles.kind}>
                  {CALENDAR_KIND_LABELS[entry.kind]}
                </AppText>
                <View style={styles.grow}>
                  <AppText variant="body" numberOfLines={1}>
                    {entry.title}
                  </AppText>
                  {entry.detail ? (
                    <AppText variant="caption" tone="faint" numberOfLines={1}>
                      {entry.detail}
                    </AppText>
                  ) : null}
                </View>
                <AppText variant="caption" tone="accent">
                  Open
                </AppText>
              </Pressable>
            ) : (
              <View style={styles.row}>
                <AppText variant="caption" tone="muted" style={styles.kind}>
                  {CALENDAR_KIND_LABELS[entry.kind]}
                </AppText>
                <View style={styles.grow} accessible accessibilityLabel={spoken}>
                  <AppText variant="body" numberOfLines={1}>
                    {entry.title}
                  </AppText>
                  {entry.detail ? (
                    <AppText variant="caption" tone="faint" numberOfLines={1}>
                      {entry.detail}
                    </AppText>
                  ) : null}
                </View>
              </View>
            )}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pressed: { opacity: 0.6 },
  kind: { minWidth: 72 },
  grow: { flex: 1 },
  divider: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.2,
    marginHorizontal: 16,
  },
});
