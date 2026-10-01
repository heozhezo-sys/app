/**
 * PDF reader.
 *
 * This screen exists to make the engine's measured capabilities visible. The
 * specification is explicit that the UI must clearly indicate what a document cannot
 * do, so a document that cannot be rendered or searched gets a plain explanation of
 * that fact — never a blank page frame, a search box that silently returns nothing, or
 * a spinner that never resolves.
 *
 * Navigation is page-based and works entirely from metadata, so it is fully functional
 * with the current engine. Rendering and text search appear when a rasterising engine
 * is added, and no part of this file needs to change to accommodate one.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, StateView } from '@/components/Layout';
import { useBook, useBookmarks, useOpenBook } from '@/features/books/hooks/useBooks';
import * as service from '@/services/booksService';
import { useTheme } from '@/theme/ThemeProvider';
import type { PdfDocumentHandle, PdfOutlineNode } from '@/pdf/engine/types';

export default function BookReaderScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const bookId = typeof id === 'string' ? id : null;
  const book = useBook(bookId);
  const opened = useOpenBook(bookId);
  const bookmarks = useBookmarks(bookId);

  const [outline, setOutline] = useState<PdfOutlineNode[]>([]);
  const [saved, setSaved] = useState(false);

  const handle: PdfDocumentHandle | null =
    opened.status === 'ready' && opened.data?.ok === true ? opened.data.document : null;
  const pageCount = handle?.pageCount ?? 0;

  /*
   * The resume position is *derived* from the book until the reader moves, rather than
   * copied into state by an effect. Deriving avoids a render where the page counter
   * shows the wrong number, and it means a book that reloads with a different length
   * re-clamps itself instead of needing a synchronising effect.
   */
  const resumePage = book.data ? Math.min(book.data.currentPage, Math.max(0, pageCount - 1)) : 0;
  const [userPage, setUserPage] = useState<number | null>(null);
  const page = userPage ?? resumePage;

  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    void handle.getOutline().then((nodes) => {
      if (!cancelled) setOutline(nodes);
    });
    return () => {
      cancelled = true;
      // Idempotent, so unmounting mid-load is safe.
      void handle.close();
    };
  }, [handle]);

  const goTo = useCallback(
    (next: number) => {
      if (pageCount === 0) return;
      const clamped = Math.min(Math.max(0, next), pageCount - 1);
      setUserPage(clamped);
      if (bookId) void service.saveProgress(bookId, clamped).then(() => setSaved(true));
    },
    [bookId, pageCount],
  );

  const toggleBookmark = useCallback(() => {
    if (!bookId) return;
    void service.setBookmark(bookId, page, page + 1 === pageCount ? 'Last page' : null);
  }, [bookId, page, pageCount]);

  if (book.status === 'loading' || opened.status === 'loading') {
    return (
      <Screen>
        <StateView state="loading" loadingLabel="Opening the document" />
      </Screen>
    );
  }

  if (book.status === 'error') {
    return (
      <Screen>
        <StateView
          state="error"
          errorMessage={book.error?.message}
          onRetry={() => {
            void book.refresh();
            void opened.refresh();
          }}
        />
      </Screen>
    );
  }

  if (!book.data) {
    return (
      <Screen>
        <StateView
          state="empty"
          emptyTitle="Book not found"
          emptyBody="It may have been removed from your library."
        />
      </Screen>
    );
  }

  // A document that cannot be opened gets its specific reason, not a generic error.
  if (opened.status === 'ready' && opened.data && opened.data.ok === false) {
    return (
      <Screen>
        <View style={{ paddingTop: insets.top + theme.spacing.sm }}>
          <StateView
            state="error"
            title="This document cannot be opened"
            errorMessage={opened.data.failure.detail}
          />
          <Spacer size="md" />
          <Button label="Back to library" onPress={() => router.back()} fullWidth />
        </View>
      </Screen>
    );
  }

  const capabilities = handle?.capabilities;
  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xl,
        }}
      >
        <AppText variant="title" accessibilityRole="header" numberOfLines={2}>
          {book.data.title}
        </AppText>
        {book.data.author ? (
          <AppText variant="caption" tone="muted">
            {book.data.author}
          </AppText>
        ) : null}

        <Spacer size="md" />

        {capabilities && !capabilities.rendering ? (
          <Card>
            <AppText variant="subheading">Page images are not available</AppText>
            <Spacer size="xs" />
            <AppText variant="caption" tone="muted">
              This build can read the structure of a PDF — its page count, metadata and
              contents — but cannot draw its pages. Everything below still works.
            </AppText>
          </Card>
        ) : null}

        <Spacer size="md" />

        <Card>
          <AppText variant="subheading">
            Page {pageCount === 0 ? 1 : page + 1} of {pageCount}
          </AppText>
          <Spacer size="xs" />
          <AppText variant="caption" tone="muted" accessibilityLiveRegion="polite">
            {saved
              ? 'Progress saved'
              : `${Math.round((pageCount ? page / pageCount : 0) * 100)}% through`}
          </AppText>
          <Spacer size="md" />

          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <Button
              label="Previous"
              variant="secondary"
              onPress={() => goTo(page - 1)}
              disabled={page === 0}
              fullWidth
              testID="prev-page"
            />
            <Button
              label="Next"
              variant="secondary"
              onPress={() => goTo(page + 1)}
              disabled={pageCount === 0 || page >= pageCount - 1}
              fullWidth
              testID="next-page"
            />
          </View>
          <Spacer size="sm" />
          <Button
            label={
              bookmarks.data?.some((b) => b.page === page)
                ? 'Remove bookmark'
                : 'Bookmark this page'
            }
            variant="ghost"
            onPress={toggleBookmark}
            fullWidth
          />
        </Card>

        {capabilities && !capabilities.textSearch ? (
          <>
            <Spacer size="md" />
            <Card>
              <AppText variant="subheading">Search is unavailable</AppText>
              <Spacer size="xs" />
              <AppText variant="caption" tone="muted">
                Searching inside a PDF needs its text layer, which this build does not
                read. The contents list below is the alternative.
              </AppText>
            </Card>
          </>
        ) : null}

        {outline.length > 0 ? (
          <>
            <Spacer size="md" />
            <AppText variant="subheading">Contents</AppText>
            <Spacer size="xs" />
            {outline.map((node) => (
              <OutlineRow
                key={`${node.title}-${node.pageIndex ?? -1}`}
                node={node}
                depth={0}
                onSelect={(index) => goTo(index)}
              />
            ))}
          </>
        ) : (
          <>
            <Spacer size="md" />
            <Card>
              <AppText variant="caption" tone="muted">
                This document has no table of contents.
              </AppText>
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function OutlineRow({
  node,
  depth,
  onSelect,
}: {
  node: PdfOutlineNode;
  depth: number;
  onSelect: (pageIndex: number) => void;
}): React.ReactElement {
  const theme = useTheme();
  const reachable = node.pageIndex !== null;

  return (
    <View style={{ marginLeft: depth * theme.spacing.md, marginTop: theme.spacing.xxs }}>
      <Button
        label={node.title}
        variant="ghost"
        size="compact"
        disabled={!reachable}
        onPress={() => {
          if (node.pageIndex !== null) onSelect(node.pageIndex);
        }}
        // A destination that could not be resolved is stated rather than hidden, so the
        // reader knows the entry exists but is not navigable.
        accessibilityHint={
          reachable ? 'Go to this section' : 'This section has no reachable destination'
        }
        fullWidth
      />
      {node.children.map((child) => (
        <OutlineRow
          key={`${child.title}-${child.pageIndex ?? -1}`}
          node={child}
          depth={depth + 1}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}
