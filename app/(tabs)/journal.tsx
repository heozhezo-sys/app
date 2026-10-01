/**
 * Journal.
 *
 * Everything here stays on the device. There is no sync, share or upload control, and
 * none should be added without the user's explicit action â€” `FEATURES/JOURNAL.md` requires
 * that contents are never transmitted silently.
 *
 * The search field reports which engine answered, because the `LIKE` fallback used on
 * Android builds without FTS5 is genuinely slower and the user deserves to know.
 */

import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, StateView } from '@/components/Layout';
import { TextField } from '@/components/TextField';
import {
  useCreateEntry,
  useDeleteEntry,
  useJournalEntries,
  useJournalSearch,
  useToggleFavorite,
  type JournalFilter,
} from '@/features/journal/hooks/useJournal';
import { useJournalLock } from '@/features/settings/hooks/useSettingsActions';
import * as journalService from '@/services/journalService';
import { isValidationError } from '@/services/errors';
import { useSettings } from '@/stores/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';

interface EntrySummary {
  id: string;
  title: string | null;
  entryDate: string;
  isFavorite: boolean;
  preview: string;
}

/** A one-line preview for the list, without truncating mid-word into nonsense. */
function previewOf(body: string): string {
  const single = body.replace(/\s+/g, ' ').trim();
  return single.length <= 90 ? single : `${single.slice(0, 90)}…`;
}

export default function JournalScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [filter, setFilter] = useState<JournalFilter>('all');
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const settings = useSettings();
  const lockEnabled = settings.journalLockEnabled;
  const lock = useJournalLock();

  // The unlock flag lives in memory so it clears on restart. That is the whole point of
  // the lock, so this screen re-checks every time it comes back into view rather than
  // trusting the state it had when it was last focused.
  const refreshLock = lock.refresh;
  const lockOnBlur = lock.relock.run;
  useFocusEffect(
    useCallback(() => {
      void refreshLock();
      // Re-lock on the way out, so switching tabs and coming back asks again.
      return () => {
        void lockOnBlur();
      };
    }, [lockOnBlur, refreshLock]),
  );

  const hidden = lockEnabled && lock.data?.unlocked !== true;

  const entries = useJournalEntries(filter, 30, !hidden);
  const search = useJournalSearch(query, !hidden);
  const create = useCreateEntry();
  const toggleFavorite = useToggleFavorite();
  const remove = useDeleteEntry();

  // Searching replaces the list rather than filtering it, so the two can never disagree
  // about which entries exist.
  const searching = query.trim() !== '';
  const list = (searching ? search.data : entries.data) ?? [];
  const shown: EntrySummary[] = list.map((entry) => ({
    id: entry.id,
    title: entry.title,
    entryDate: entry.entryDate,
    isFavorite: entry.isFavorite,
    preview: previewOf(entry.body),
  }));

  const save = useCallback(async () => {
    setErrors({});
    try {
      await journalService.createEntry({ title, body });
      setBody('');
      setTitle('');
      setComposing(false);
      await entries.refresh();
    } catch (error) {
      if (isValidationError(error)) {
        setErrors(error.fields as Record<string, string>);
        return;
      }
      setErrors({ body: 'That entry could not be saved.' });
    }
  }, [body, entries, title]);

  const refreshAll = useCallback(async () => {
    await entries.refresh();
    if (searching) await search.refresh();
  }, [entries, search, searching]);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <AppText variant="display" accessibilityRole="header">
          Journal
        </AppText>
        <AppText variant="caption" tone="muted">
          Stored on this device only.
        </AppText>

        <Spacer size="md" />

        {/*
          The lock gate. Nothing below this line renders while the journal is hidden, so
          a preview of an entry is never on screen even for a frame, and the list is not
          fetched at all while locked.
        */}
        {hidden ? (
          <Card>
            <AppText variant="subheading">Journal locked</AppText>
            <Spacer size="xs" />
            <AppText variant="caption" tone="muted">
              {lock.data?.blockedReason ??
                'Authenticate with your device to open your journal.'}
            </AppText>
            <Spacer size="md" />
            <Button
              label="Unlock"
              onPress={() => void lock.unlock.run()}
              loading={lock.unlock.pending}
              disabled={lock.data?.blockedReason !== null && lock.data !== undefined}
              fullWidth
              testID="journal-unlock"
            />
            {lock.unlock.error ? (
              <>
                <Spacer size="sm" />
                <AppText variant="caption" tone="danger" accessibilityRole="alert">
                  {lock.unlock.error.message}
                </AppText>
              </>
            ) : null}
          </Card>
        ) : (
          <>
            <TextField
              label="Search entries"
              value={query}
              onChangeText={setQuery}
              placeholder="Search your writing"
              testID="journal-search"
            />

            {searching && search.strategy === 'like' ? (
              <>
                <Spacer size="xs" />
                {/* Honest about the slower path rather than implying the index ran. */}
                <AppText variant="micro" tone="muted">
                  Searching without an index on this device, which is slower.
                </AppText>
              </>
            ) : null}

            <Spacer size="sm" />
            <View style={styles.row}>
              <Button
                label="All"
                variant={filter === 'all' ? 'primary' : 'secondary'}
                onPress={() => setFilter('all')}
                selected={filter === 'all'}
                accessibilityHint="Show every entry"
              />
              <Button
                label="Favourites"
                variant={filter === 'favorites' ? 'primary' : 'secondary'}
                onPress={() => setFilter('favorites')}
                selected={filter === 'favorites'}
                accessibilityHint="Show only entries you marked as favourites"
              />
            </View>

            <Spacer size="md" />

            {composing ? (
              <Card>
                <AppText variant="subheading">New entry</AppText>
                <Spacer size="sm" />
                <TextField
                  label="Title"
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Optional"
                  error={errors.title}
                  testID="journal-title"
                />
                <Spacer size="sm" />
                <TextField
                  label="What happened?"
                  value={body}
                  onChangeText={setBody}
                  placeholder="Write freely"
                  multiline
                  error={errors.body}
                  testID="journal-body"
                />
                <Spacer size="md" />
                <View style={styles.row}>
                  <Button
                    label="Save entry"
                    onPress={() => void save()}
                    loading={create.pending}
                    disabled={create.pending}
                    testID="journal-save"
                  />
                  <Button
                    label="Cancel"
                    variant="ghost"
                    onPress={() => {
                      setComposing(false);
                      setErrors({});
                    }}
                  />
                </View>
              </Card>
            ) : (
              <Button label="Write an entry" onPress={() => setComposing(true)} fullWidth />
            )}

            <Spacer size="md" />

            {renderList()}
          </>
        )}

        <TextField
          label="Search entries"
          value={query}
          onChangeText={setQuery}
          placeholder="Search your writing"
          testID="journal-search"
        />

        {searching && search.strategy === 'like' ? (
          <>
            <Spacer size="xs" />
            {/* Honest about the slower path rather than implying the index ran. */}
            <AppText variant="micro" tone="muted">
              Searching without an index on this device, which is slower.
            </AppText>
          </>
        ) : null}

        <Spacer size="sm" />
        <View style={styles.row}>
          <Button
            label="All"
            variant={filter === 'all' ? 'primary' : 'secondary'}
            onPress={() => setFilter('all')}
            selected={filter === 'all'}
            accessibilityHint="Show every entry"
          />
          <Button
            label="Favourites"
            variant={filter === 'favorites' ? 'primary' : 'secondary'}
            onPress={() => setFilter('favorites')}
            selected={filter === 'favorites'}
            accessibilityHint="Show only entries you marked as favourites"
          />
        </View>

        <Spacer size="md" />

        {composing ? (
          <Card>
            <AppText variant="subheading">New entry</AppText>
            <Spacer size="sm" />
            <TextField
              label="Title"
              value={title}
              onChangeText={setTitle}
              placeholder="Optional"
              error={errors.title}
              testID="journal-title"
            />
            <Spacer size="sm" />
            <TextField
              label="What happened?"
              value={body}
              onChangeText={setBody}
              placeholder="Write freely"
              multiline
              error={errors.body}
              testID="journal-body"
            />
            <Spacer size="md" />
            <View style={styles.row}>
              <Button
                label="Save entry"
                onPress={() => void save()}
                loading={create.pending}
                disabled={create.pending}
                testID="journal-save"
              />
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => {
                  setComposing(false);
                  setErrors({});
                }}
              />
            </View>
          </Card>
        ) : (
          <Button label="Write an entry" onPress={() => setComposing(true)} fullWidth />
        )}

        <Spacer size="md" />

        {renderList()}
      </ScrollView>
    </Screen>
  );

  /** Search replaces the list; otherwise the all/favourites filter applies. */
  function renderList(): React.ReactElement {
    if (searching) {
      if (search.status === 'loading') {
        return <StateView state="loading" compact loadingLabel="Searching" />;
      }
      if (shown.length === 0) {
        return (
          <Card>
            <AppText variant="caption" tone="muted">
              Nothing matches that search.
            </AppText>
          </Card>
        );
      }

      return entryList();
    }

    if (entries.status === 'loading') {
      return <StateView state="loading" loadingLabel="Loading your journal" />;
    }
    if (entries.status === 'error' && entries.data === null) {
      return (
        <StateView
          state="error"
          errorMessage={entries.error?.message}
          onRetry={() => void entries.refresh()}
        />
      );
    }
    if (shown.length === 0) {
      return (
        <Card>
          <AppText variant="subheading">
            {filter === 'favorites' ? 'No favourites yet' : 'Nothing written yet'}
          </AppText>
          <Spacer size="xs" />
          <AppText variant="caption" tone="muted">
            {filter === 'favorites'
              ? 'Mark an entry as a favourite to find it quickly later.'
              : 'Entries are saved on this device and are never sent anywhere.'}
          </AppText>
        </Card>
      );
    }
    return entryList();
  }

  function entryList(): React.ReactElement {
    return (
      <EntryList
        entries={shown}
        onToggleFavorite={(id) => void toggleFavorite.run(id).then(refreshAll)}
        onDelete={(id) => void remove.run(id).then(refreshAll)}
      />
    );
  }
}


function EntryList({
  entries,
  onToggleFavorite,
  onDelete,
}: {
  entries: readonly EntrySummary[];
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string) => void;
}): React.ReactElement {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {entries.map((entry) => (
        <Card key={entry.id}>
          <AppText variant="subheading">{entry.title ?? 'Untitled entry'}</AppText>
          <AppText variant="caption" tone="muted">
            {entry.entryDate} · {entry.preview}
          </AppText>
          <Spacer size="sm" />
          <View style={styles.row}>
            <Button
              label={entry.isFavorite ? 'Unfavourite' : 'Favourite'}
              variant="ghost"
              size="compact"
              onPress={() => onToggleFavorite(entry.id)}
              selected={entry.isFavorite}
              accessibilityHint={
                entry.isFavorite
                  ? 'Removes this entry from favourites'
                  : 'Marks this entry as a favourite'
              }
            />
            <Button
              label="Delete"
              variant="ghost"
              size="compact"
              onPress={() => onDelete(entry.id)}
              accessibilityHint={`Delete the entry from ${entry.entryDate}`}
            />
          </View>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
});
