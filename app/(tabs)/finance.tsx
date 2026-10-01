/**
 * Finance.
 *
 * Accounts, transactions, transfers and budgets, all local. Nothing here talks to a
 * network: `FEATURES/FINANCE.md` requires finance records stay local by default, and the
 * service layer has no transport at all.
 *
 * **Amounts are never held as decimals in this file.** Every value arriving from the hooks
 * is an integer number of minor units and is rendered through `formatMinor`. The amount a
 * user types stays a *string* until the service parses it, so no `Number(...)` or
 * `parseFloat` ever touches a currency value on its way to storage.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button, Spacer } from '@/components/Button';
import { Card, Screen, StateView } from '@/components/Layout';
import { TextField } from '@/components/TextField';
import {
  useAccountSummaries,
  useBudgetProgress,
  useCategories,
  useCreateAccount,
  useRecordTransaction,
  useRecordTransfer,
  useToday,
  useTransactions,
} from '@/features/finance/hooks/useFinance';
import { isValidationError } from '@/services/errors';
import { formatMinor } from '@/utils/money';
import { useTheme } from '@/theme/ThemeProvider';

type Mode = 'expense' | 'income' | 'transfer';

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'expense', label: 'Expense' },
  { mode: 'income', label: 'Income' },
  { mode: 'transfer', label: 'Transfer' },
];

/**
 * A labelled amount.
 *
 * VoiceOver reads a bare number with no context, which is useless in a list of balances, so
 * each figure carries its meaning and currency in the accessibility label. The sign is
 * spoken too, via `formatMinor`'s `showSign`, because "-$12.00" and "$12.00" are different
 * facts.
 */
function Amount({
  minor,
  currency,
  label,
  tone = 'default',
  variant = 'body',
}: {
  minor: number;
  currency: string;
  label: string;
  tone?: 'default' | 'muted' | 'danger';
  variant?: 'body' | 'subheading' | 'display';
}): React.ReactElement {
  return (
    <AppText
      variant={variant}
      tone={tone}
      accessibilityLabel={`${label}: ${formatMinor(minor, currency, { showSign: true })}`}
    >
      {formatMinor(minor, currency, { showSign: true })}
    </AppText>
  );
}

/** An inline validation message, announced immediately when it appears. */
function FieldError({ message }: { message: string | undefined }): React.ReactElement | null {
  if (!message) return null;
  return (
    <AppText variant="caption" tone="danger" accessibilityRole="alert">
      {message}
    </AppText>
  );
}

export default function FinanceScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const today = useToday();

  const accounts = useAccountSummaries();
  const categories = useCategories();
  const transactions = useTransactions({ limit: 20 });
  const budgets = useBudgetProgress('monthly', today);
  const createAccount = useCreateAccount();
  const record = useRecordTransaction();
  const transfer = useRecordTransfer();

  const [mode, setMode] = useState<Mode>('expense');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Stable empty arrays rather than `?? []` inline: a fresh literal on every render would
  // make the `activeAccount` memo below re-run each time and defeat its purpose.
  const accountList = useMemo(() => accounts.data ?? [], [accounts.data]);
  const categoryList = useMemo(() => categories.data ?? [], [categories.data]);
  const transactionList = useMemo(() => transactions.data ?? [], [transactions.data]);
  const budgetList = useMemo(() => budgets.data ?? [], [budgets.data]);

  /** The account an entry is filed against; falls back to the first available. */
  const activeAccount = useMemo(
    () => accountList.find((a) => a.id === accountId) ?? accountList[0],
    [accountId, accountList],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([
      accounts.refresh(),
      categories.refresh(),
      transactions.refresh(),
      budgets.refresh(),
    ]);
  }, [accounts, budgets, categories, transactions]);

  const submit = useCallback(async () => {
    setErrors({});
    if (!activeAccount) {
      setErrors({ accountId: 'Add an account first.' });
      return;
    }

    try {
      if (mode === 'transfer') {
        await transfer.run({
          fromAccountId: activeAccount.id,
          toAccountId: toAccountId,
          amount,
        });
      } else {
        await record.run({
          accountId: activeAccount.id,
          categoryId: categoryId || null,
          kind: mode,
          amount,
        });
      }
      // Only the typed string is cleared; the parsed value lives in the database.
      setAmount('');
      await refreshAll();
    } catch (error) {
      if (isValidationError(error)) {
        setErrors(error.fields as Record<string, string>);
        return;
      }
      setErrors({ amount: 'That could not be saved. Try again.' });
    }
  }, [activeAccount, amount, categoryId, mode, record, refreshAll, toAccountId, transfer]);

  const addAccount = useCallback(async () => {
    setErrors({});
    try {
      await createAccount.run({
        name: accountName,
        type: 'cash',
        currency: 'USD',
        openingBalance: '0',
      });
      setAccountName('');
      await accounts.refresh();
    } catch (error) {
      if (isValidationError(error)) {
        setErrors(error.fields as Record<string, string>);
        return;
      }
      setErrors({ name: 'That account could not be added.' });
    }
  }, [accountName, accounts, createAccount]);

  const currency = activeAccount?.currency ?? 'USD';
  /** Categories are kind-specific: an expense cannot be filed under an income category. */
  const visibleCategories = categoryList.filter((category) => category.kind === mode);
  const transferTargets = accountList.filter((account) => account.id !== activeAccount?.id);

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
          Finance
        </AppText>

        <Spacer size="lg" />

        {accounts.status === 'loading' ? (
          <StateView state="loading" compact loadingLabel="Loading accounts" />
        ) : accountList.length === 0 ? (
          <StateView
            state="empty"
            compact
            emptyTitle="No accounts yet"
            emptyBody="Add an account to start tracking."
          />
        ) : (
          <Card>
            <AppText variant="subheading">Accounts</AppText>
            <Spacer size="xs" />
            {accountList.map((account, index) => (
              <View key={account.id}>
                {index > 0 && <View style={styles.divider} />}
                <View style={styles.row}>
                  <View style={styles.grow}>
                    <AppText variant="body" numberOfLines={1}>
                      {account.name}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {account.currency} · spent {formatMinor(account.balance.expenseMinor, account.currency)}
                    </AppText>
                  </View>
                  <Amount
                    minor={account.balance.totalMinor}
                    currency={account.currency}
                    label={`${account.name} balance`}
                    variant="body"
                  />
                </View>
              </View>
            ))}
          </Card>
        )}


        <Spacer size="md" />

        <AppText variant="subheading">Record</AppText>
        <Spacer size="xs" />

        <Card>
          <View style={styles.row}>
            {MODES.map((entry, index) => (
              <React.Fragment key={entry.mode}>
                {index > 0 && <Spacer size="xs" />}
                <Button
                  label={entry.label}
                  onPress={() => setMode(entry.mode)}
                  variant={mode === entry.mode ? 'primary' : 'secondary'}
                  size="compact"
                  selected={mode === entry.mode}
                  style={styles.grow}
                  testID={`finance-mode-${entry.mode}`}
                />
              </React.Fragment>
            ))}
          </View>

          <Spacer size="sm" />

          <TextField
            label="Amount"
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            // The keyboard is a convenience only. The service parses the string and
            // validates it, so a hardware keyboard cannot produce a bad amount.
            keyboardType="decimal-pad"
            error={errors.amount}
            testID="finance-amount"
          />

          {activeAccount && (
            <>
              <Spacer size="sm" />
              <AppText variant="caption" tone="muted">
                Account
              </AppText>
              <Spacer size="xs" />
              {accountList.length > 1 && (
                <>
                  <View style={styles.wrapRow}>
                    {accountList.map((account) => (
                      <View key={account.id} style={styles.chip}>
                        <Button
                          label={account.name}
                          onPress={() => setAccountId(account.id)}
                          variant={activeAccount.id === account.id ? 'primary' : 'secondary'}
                          size="compact"
                          selected={activeAccount.id === account.id}
                          testID={`finance-account-${account.id}`}
                        />
                      </View>
                    ))}
                  </View>
                  <Spacer size="xs" />
                </>
              )}
              <AppText variant="caption" tone="muted">
                Recording against {activeAccount.name} ({currency})
              </AppText>
            </>
          )}
          <FieldError message={errors.accountId} />

          <Spacer size="sm" />

          {mode === 'transfer' ? (
            <>
              <AppText variant="caption" tone="muted">
                Transfer to
              </AppText>
              <Spacer size="xs" />
              {transferTargets.length === 0 ? (
                <AppText variant="caption" tone="muted">
                  Add a second account to transfer between them.
                </AppText>
              ) : (
                <View style={styles.wrapRow}>
                  {transferTargets.map((account) => (
                    <View key={account.id} style={styles.chip}>
                      <Button
                        label={account.name}
                        onPress={() => setToAccountId(account.id)}
                        variant={toAccountId === account.id ? 'primary' : 'secondary'}
                        size="compact"
                        selected={toAccountId === account.id}
                        testID={`finance-transfer-${account.id}`}
                      />
                    </View>
                  ))}
                </View>
              )}
              {toAccountId && (
                <AppText variant="caption" tone="muted">
                  Both legs are written together, so this either moves the money or does
                  nothing.
                </AppText>
              )}
            </>
          ) : (
            <>
              <AppText variant="caption" tone="muted">
                Category
              </AppText>
              <Spacer size="xs" />
              {visibleCategories.length === 0 ? (
                <AppText variant="caption" tone="muted">
                  No {mode} categories yet.
                </AppText>
              ) : (
                <View style={styles.wrapRow}>
                  {visibleCategories.map((category) => (
                    <View key={category.id} style={styles.chip}>
                      <Button
                        label={category.name}
                        onPress={() => setCategoryId(category.id)}
                        variant={categoryId === category.id ? 'primary' : 'secondary'}
                        size="compact"
                        selected={categoryId === category.id}
                        testID={`finance-category-${category.id}`}
                      />
                    </View>
                  ))}
                </View>
              )}
              <FieldError message={errors.categoryId} />
            </>
          )}

          <Spacer size="md" />

          <Button
            label={mode === 'transfer' ? 'Transfer' : 'Save'}
            onPress={submit}
            loading={record.pending || transfer.pending}
            disabled={accountList.length === 0}
            fullWidth
            testID="finance-submit"
          />
        </Card>

        <Spacer size="md" />

        <AppText variant="subheading">Add an account</AppText>
        <Spacer size="xs" />

        <Card>
          <TextField
            label="Name"
            value={accountName}
            onChangeText={setAccountName}
            placeholder="Cash, Checking…"
            error={errors.name}
            testID="finance-account-name"
          />
          <Spacer size="sm" />
          <Button
            label="Add account"
            onPress={addAccount}
            variant="secondary"
            loading={createAccount.pending}
            disabled={accountName.trim() === ''}
            fullWidth
            testID="finance-add-account"
          />
        </Card>


        <Spacer size="md" />

        <AppText variant="subheading">This month&apos;s budgets</AppText>
        <Spacer size="xs" />

        {budgets.status === 'loading' ? (
          <StateView state="loading" compact loadingLabel="Loading budgets" />
        ) : budgetList.length === 0 ? (
          <StateView
            state="empty"
            compact
            emptyTitle="No budgets set"
            emptyBody="Set a limit to track a category."
          />
        ) : (
          <Card>
            {budgetList.map((budget, index) => {
              const name =
                categoryList.find((c) => c.id === budget.categoryId)?.name ?? 'Category';
              return (
                <View key={`${budget.categoryId}-${budget.periodKey}`}>
                  {index > 0 && <View style={styles.divider} />}
                  <View style={styles.row}>
                    <AppText variant="body" style={styles.grow} numberOfLines={1}>
                      {name}
                    </AppText>
                    <Amount
                      minor={budget.state.remainingMinor}
                      currency={currency}
                      label={budget.state.overBudget ? `${name} overspent by` : `${name} remaining`}
                      tone={budget.state.overBudget ? 'danger' : 'default'}
                    />
                  </View>
                  <AppText variant="caption" tone="muted">
                    {budget.state.percentUsed}% of {formatMinor(budget.state.limitMinor, currency)} used
                  </AppText>
                </View>
              );
            })}
          </Card>
        )}

        <Spacer size="md" />

        <AppText variant="subheading">Recent activity</AppText>
        <Spacer size="xs" />

        {transactions.status === 'loading' ? (
          <StateView state="loading" compact loadingLabel="Loading transactions" />
        ) : transactionList.length === 0 ? (
          <StateView state="empty" compact emptyTitle="Nothing recorded yet" />
        ) : (
          <Card>
            {transactionList.map((transaction, index) => (
              <View key={transaction.id}>
                {index > 0 && <View style={styles.divider} />}
                <View style={styles.row}>
                  <View style={styles.grow}>
                    <AppText variant="body" numberOfLines={1}>
                      {transaction.payee ??
                        (transaction.kind === 'transfer' ? 'Transfer' : 'Transaction')}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {new Date(transaction.occurredAt).toLocaleDateString()}
                    </AppText>
                  </View>
                  <Amount
                    // Stored amounts are positive; direction lives in `kind`, so the sign
                    // is applied here for display only and never stored.
                    minor={
                      transaction.kind === 'expense'
                        ? -transaction.amountMinor
                        : transaction.amountMinor
                    }
                    currency={transaction.currency}
                    label={
                      transaction.kind === 'expense'
                        ? 'Spent'
                        : transaction.kind === 'income'
                          ? 'Received'
                          : 'Transferred'
                    }
                    tone={transaction.kind === 'expense' ? 'danger' : 'default'}
                  />
                </View>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    marginRight: 8,
    marginBottom: 8,
  },
  grow: {
    flex: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.2,
    marginVertical: 4,
  },
});

