/**
 * Data, backup and journal exports.
 *
 * Restore is the only thing in LifeOS that can destroy a user's history, so this screen
 * is built around three separate gates rather than one confirm:
 *
 *   1. The file is inspected first and its contents are shown before anything is written.
 *   2. The restore takes a safety copy of the current state before it starts.
 *   3. Undo stays available afterwards, so a mistake is recoverable rather than final.
 *
 * Nothing here uploads anything. The backup is written into app storage and the journal
 * exports are files the user owns, which is the whole privacy promise in one file.
 */

import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, Section, StateView } from '@/components/Layout';
import {
  useDeleteJournalExport,
  useExportBackup,
  useExportJournal,
  useInspectBackup,
  useJournalExports,
  useRestoreControls,
} from '@/features/settings/hooks/useSettingsActions';
import { EXPORT_FORMATS, EXPORT_FORMAT_LABELS } from '@/journal/export';
import type { ExportFormat } from '@/journal/export';
import { EXPORT_PRIVACY_WARNING } from '@/services/journalExportService';
import type { BackupSummary } from '@/services/backupService';
import { useTheme } from '@/theme/ThemeProvider';

/** `KB` with one decimal only when it matters; a whole number otherwise. */
function fileSize(bytes: number): string {
  const kb = bytes / 1024;
  return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`;
}

export default function DataSettingsScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const exportBackup = useExportBackup();
  const inspect = useInspectBackup();
  const restoreControls = useRestoreControls();

  const exports = useJournalExports();
  const exportJournal = useExportJournal();
  const deleteExport = useDeleteJournalExport();

  const [pickedJson, setPickedJson] = useState('');
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'muted' | 'danger'>('muted');
  const [journalFormat, setJournalFormat] = useState<ExportFormat>('markdown');

  const say = useCallback((text: string, nextTone: 'muted' | 'danger' = 'muted') => {
    setMessage(text);
    setTone(nextTone);
  }, []);

  const runExport = useCallback(async () => {
    setMessage(null);
    const result = await exportBackup.run();
    if (!result) return;
    // A successful export has no `message`; say what was written instead of leaving the
    // user staring at an unchanged screen.
    say(
      result.ok
        ? `Saved ${result.rowCount} records and ${result.document.files.length} files.`
        : result.message,
      result.ok ? 'muted' : 'danger',
    );
  }, [exportBackup, say]);

  const pickBackup = useCallback(async () => {
    setMessage(null);
    setPickedJson('');
    setSummary(null);

    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'public.json', '*/*'],
      // `copyToCacheDirectory` matters on iOS: the picker's temporary file is not
      // guaranteed to survive the read.
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled) return;
    const asset = picked.assets?.[0];
    if (!asset) return;

    try {
      const response = await fetch(asset.uri);
      const text = await response.text();
      const described = await inspect.run(text);
      // An unreadable file is refused here rather than at restore time, so the user finds
      // out before anything has been written.
      if (!described) {
        say('That file is not a LifeOS backup.', 'danger');
        return;
      }
      setPickedJson(text);
      setSummary(described);
    } catch {
      say('That file could not be read.', 'danger');
    }
  }, [inspect, say]);

  const runRestore = useCallback(async () => {
    const result = await restoreControls.restore.run(pickedJson);
    if (!result) return;
    if (!result.ok) {
      say(result.message, 'danger');
      return;
    }

    const missing =
      result.missingFiles.length === 0
        ? 'Every file in the backup is present.'
        : `${result.missingFiles.length} file(s) in the backup were not on this device, so their records point at nothing yet.`;
    say(
      `Restored ${result.rowsRestored} records across ${result.tablesRestored} tables. ${missing}`,
    );
    await exports.refresh();
  }, [exports, pickedJson, restoreControls.restore, say]);

  const runUndo = useCallback(async () => {
    const result = await restoreControls.undo.run();
    if (!result) return;
    if (result.ok) {
      say(`Undone. ${result.rowsRestored} records put back.`);
    } else {
      say(result.message, 'danger');
    }
  }, [restoreControls.undo, say]);

  const runJournalExport = useCallback(async () => {
    const outcome = await exportJournal.run({ format: journalFormat });
    if (!outcome) return;
    if (outcome.ok) {
      say(`Saved ${outcome.export.filePath} (${fileSize(outcome.export.sizeBytes)}).`);
      await exports.refresh();
    } else {
      say(outcome.message, 'danger');
    }
  }, [exportJournal, exports, journalFormat, say]);

  const removeExport = useCallback(
    async (filePath: string) => {
      await deleteExport.run(filePath);
      await exports.refresh();
    },
    [deleteExport, exports],
  );

  const exportList = exports.data ?? [];

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
          Data
        </AppText>
        <Spacer size="xs" />
        <AppText variant="caption" tone="muted">
          Your data never leaves this device. Exporting writes a file you own and can move
          anywhere you like.
        </AppText>

        <Spacer size="lg" />

        <Section title="Backup">
          <Card>
            <AppText variant="caption" tone="muted">
              A backup holds every record and the PDF files you have imported. Export one
              before restoring anything, and before changing phones.
            </AppText>
            <Spacer size="sm" />
            <Button
              label="Export a backup"
              onPress={runExport}
              loading={exportBackup.pending}
              fullWidth
              testID="data-export-backup"
            />
            {message ? (
              <>
                <Spacer size="sm" />
                <AppText
                  variant="caption"
                  tone={tone}
                  accessibilityLiveRegion="polite"
                  accessibilityRole={tone === 'danger' ? 'alert' : undefined}
                >
                  {message}
                </AppText>
              </>
            ) : null}
          </Card>
        </Section>

        <Section title="Restore">
          <Card>
            <AppText variant="caption" tone="muted">
              Restoring replaces everything in LifeOS with the contents of a backup. Your
              current data is saved first, so you can undo it afterwards.
            </AppText>

            <Spacer size="md" />
            <Button
              label="Choose a backup file"
              onPress={pickBackup}
              variant="secondary"
              loading={inspect.pending}
              fullWidth
              testID="data-pick-backup"
            />

            {summary ? (
              <>
                <Spacer size="md" />
                <View style={[styles.summary, { backgroundColor: theme.colors.surfaceAlt }]}>
                  <AppText variant="body" weight="600">
                    {summary.rowCount} records · {summary.fileCount} files
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    Taken {new Date(summary.createdAt).toLocaleString()} · schema v
                    {summary.schemaVersion} · {fileSize(summary.fileBytes)} of files
                  </AppText>
                  {summary.tables.slice(0, 6).map((table) => (
                    <AppText key={table.name} variant="caption" tone="faint">
                      {table.name}: {table.rows}
                    </AppText>
                  ))}
                  {summary.tables.length > 6 ? (
                    <AppText variant="caption" tone="faint">
                      and {summary.tables.length - 6} more tables
                    </AppText>
                  ) : null}
                </View>

                <Spacer size="sm" />
                <AppText variant="caption" tone="warning">
                  Restoring replaces your current data with the counts above. It is
                  reversible, but it will remove anything recorded since.
                </AppText>
                <Spacer size="sm" />
                <Button
                  label="Restore this backup"
                  onPress={runRestore}
                  variant="danger"
                  loading={restoreControls.restore.pending}
                  fullWidth
                  accessibilityHint="Replaces your current data. You can undo this afterwards."
                  testID="data-restore-confirm"
                />
              </>
            ) : null}

            {restoreControls.restore.error ? (
              <>
                <Spacer size="sm" />
                <StateView
                  state="error"
                  compact
                  errorMessage={restoreControls.restore.error.message}
                />
              </>
            ) : null}

            <Spacer size="md" />
            <View style={styles.divider} />
            <Spacer size="md" />

            <Button
              label="Undo the last restore"
              onPress={runUndo}
              variant="secondary"
              disabled={!restoreControls.canUndo}
              loading={restoreControls.undo.pending}
              fullWidth
              accessibilityHint={
                restoreControls.canUndo
                  ? 'Puts back the data that was there before the last restore'
                  : 'There is no restore to undo in this session'
              }
              testID="data-restore-undo"
            />
            <Spacer size="xs" />
            <AppText variant="caption" tone="faint">
              Undo lasts for this session only. Restarting the app clears it.
            </AppText>
          </Card>
        </Section>

        <Section title="Journal exports">
          <Card>
            <AppText variant="caption" tone="muted">
              Export your journal as a file you can read or move elsewhere.
            </AppText>
            <Spacer size="sm" />
            <AppText variant="caption" tone="warning">
              {EXPORT_PRIVACY_WARNING}
            </AppText>

            <Spacer size="md" />
            <View style={styles.row}>
              {EXPORT_FORMATS.map((format) => (
                <Button
                  key={format}
                  label={EXPORT_FORMAT_LABELS[format]}
                  onPress={() => setJournalFormat(format)}
                  variant={journalFormat === format ? 'primary' : 'secondary'}
                  size="compact"
                  selected={journalFormat === format}
                  style={styles.grow}
                  testID={`data-journal-format-${format}`}
                />
              ))}
            </View>
            <Spacer size="sm" />
            <Button
              label="Export journal"
              onPress={runJournalExport}
              loading={exportJournal.pending}
              fullWidth
              testID="data-journal-export"
            />

            <Spacer size="md" />
            <View style={styles.divider} />
            <Spacer size="md" />

            {exports.status === 'loading' ? (
              <StateView state="loading" compact loadingLabel="Loading exports" />
            ) : exportList.length === 0 ? (
              <StateView state="empty" compact emptyTitle="No exports yet" />
            ) : (
              exportList.map((file) => (
                <View key={file.filePath} style={styles.exportRow}>
                  <View style={styles.grow}>
                    <AppText variant="body" numberOfLines={1}>
                      {file.filePath.split('/').pop()}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {fileSize(file.sizeBytes)}
                    </AppText>
                  </View>
                  <Button
                    label="Delete"
                    variant="ghost"
                    size="compact"
                    onPress={() => void removeExport(file.filePath)}
                    accessibilityHint={`Delete the export ${file.filePath}`}
                    testID={`data-journal-delete-${file.filePath}`}
                  />
                </View>
              ))
            )}
          </Card>
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  grow: { flex: 1 },
  divider: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.2,
  },
  summary: {
    gap: 2,
    padding: 12,
    borderRadius: 10,
  },
  exportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
});
