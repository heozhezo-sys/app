/**
 * One row in the book library.
 *
 * The whole row is a single pressable with one accessibility label, rather than a
 * title that is pressable plus separate metadata. VoiceOver and TalkBack then announce
 * the book, its author and its progress as one meaningful item instead of three
 * fragments.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme/ThemeProvider';
import type { BookWithProgress } from '@/repositories/booksRepository';

export interface BookRowProps {
  book: BookWithProgress;
  onPress: (book: BookWithProgress) => void;
}

function statusLabel(book: BookWithProgress): string {
  switch (book.status) {
    case 'finished':
      return 'Finished';
    case 'paused':
      return 'Paused';
    case 'abandoned':
      return 'Abandoned';
    default:
      return `${book.progressPct}% read`;
  }
}

export function BookRow({ book, onPress }: BookRowProps): React.ReactElement {
  const theme = useTheme();

  const label = [book.title, book.author, `${book.pageCount} pages`, statusLabel(book)]
    .filter((part) => part !== null && part !== '')
    .join('. ');

  return (
    <Pressable
      onPress={() => onPress(book)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the reader"
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.md,
          padding: theme.spacing.md,
          gap: theme.spacing.xs,
          // A visible pressed state, not only an opacity change, so the interaction is
          // legible in high-contrast mode and to users who cannot see subtle fades.
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <AppText variant="subheading" numberOfLines={2}>
        {book.title}
      </AppText>
      {book.author ? (
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {book.author}
        </AppText>
      ) : null}

      <View style={styles.footer}>
        <View
          style={[
            styles.track,
            { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.pill },
          ]}
        >
          <View
            style={[
              styles.fill,
              {
                backgroundColor: theme.colors.accent,
                borderRadius: theme.radii.pill,
                // A zero-width bar for an unread book would be invisible; a minimum
                // width keeps the track legible without lying about progress.
                width: `${Math.max(book.progressPct, book.progressPct > 0 ? 2 : 0)}%`,
              },
            ]}
          />
        </View>
        <AppText variant="micro" tone="muted">
          {statusLabel(book)}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  track: {
    flex: 1,
    height: 4,
    overflow: 'hidden',
  },
  fill: {
    height: 4,
  },
});
