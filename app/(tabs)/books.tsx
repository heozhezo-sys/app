/**
 * Book library.
 *
 * Lists every book the user has imported, with derived reading progress. Import happens
 * through the system document picker, so a PDF is copied into app storage and remains
 * readable with no network connection.
 */

import React, { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, StateView } from '@/components/Layout';
import { BookRow } from '@/features/books/components/BookRow';
import { useBooks, useDeleteBook, useImportDocument } from '@/features/books/hooks/useBooks';
import { useTheme } from '@/theme/ThemeProvider';
import type { BookWithProgress } from '@/repositories/booksRepository';

export default function BooksScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const books = useBooks();
  const importDocument = useImportDocument();
  const removeBook = useDeleteBook();
  const [message, setMessage] = useState<string | null>(null);

  const all = books.data ?? [];

  const addPdf = useCallback(async () => {
    setMessage(null);
    const picked = await DocumentPicker.getDocumentAsync({
      // `copyToCacheDirectory` matters on iOS: the picker's temporary file is not
      // guaranteed to outlive the session, and we copy it into app storage anyway.
      copyToCacheDirectory: true,
      multiple: false,
      type: 'application/pdf',
    });

    if (picked.canceled) return;
    const asset = picked.assets?.[0];
    if (!asset) return;

    const outcome = await importDocument.run({ uri: asset.uri, name: asset.name });
    if (!outcome) return; // superseded or still running

    if (outcome.status === 'failed') {
      setMessage(outcome.failure.message);
      return;
    }
    router.push(`/book/${outcome.book.id}`);
  }, [importDocument, router]);

  const confirmDelete = useCallback(
    (book: BookWithProgress) => {
      Alert.alert('Remove this book?', `"${book.title}" and the stored PDF will be removed.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void removeBook.run(book.id);
          },
        },
      ]);
    },
    [removeBook],
  );

  return (
    <>
      <Screen padded={false}>
        <View
          style={{
            paddingTop: insets.top + theme.spacing.sm,
            paddingHorizontal: theme.spacing.lg,
          }}
        >
          <AppText variant="display" accessibilityRole="header">
            Books
          </AppText>
          <AppText variant="subheading" tone="muted">
            {all.length === 0 ? 'Nothing in your library yet' : `${all.length} in your library`}
          </AppText>

          <Spacer size="lg" />

          {message ? (
            <>
              <Card>
                {/* Announced as an alert so it is read out, not just shown. */}
                <AppText variant="caption" tone="danger" accessibilityRole="alert">
                  {message}
                </AppText>
              </Card>
              <Spacer size="md" />
            </>
          ) : null}

          {books.status === 'loading' ? (
            <StateView state="loading" loadingLabel="Loading your library" />
          ) : books.status === 'error' && all.length === 0 ? (
            <StateView
              state="error"
              errorMessage={books.error?.message}
              onRetry={() => void books.refresh()}
            />
          ) : all.length === 0 ? (
            <Card>
              <AppText variant="subheading">Add your first PDF</AppText>
              <Spacer size="xs" />
              <AppText variant="caption" tone="muted">
                Import a book from Files or your device. It is copied into LifeOS, so it
                stays readable offline and if the original is moved.
              </AppText>
            </Card>
          ) : (
            <View style={{ gap: theme.spacing.sm }}>
              {all.map((book) => (
                <View key={book.id}>
                  <BookRow book={book} onPress={(b) => router.push(`/book/${b.id}`)} />
                  <Spacer size="xxs" />
                  <Button
                    label={`Remove ${book.title}`}
                    variant="ghost"
                    size="compact"
                    onPress={() => confirmDelete(book)}
                    accessibilityHint="Deletes this book and its stored PDF"
                  />
                </View>
              ))}
            </View>
          )}

          <Spacer size="xl" />
        </View>
      </Screen>

      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.md,
        }}
      >
        <Button
          label="Add PDF"
          onPress={() => void addPdf()}
          loading={importDocument.pending}
          disabled={importDocument.pending}
          fullWidth
          testID="add-pdf"
        />
      </View>
    </>
  );
}
