import React from 'react';
import { ScrollView, View } from 'react-native';

import { AppText } from './AppText';
import { Button, Spacer } from './Button';
import { logger, setConsoleLogging } from '@/utils/logger';

/**
 * Catches render errors anywhere below it.
 *
 * A crash must never leave the user staring at a blank screen with no way out. This
 * shows what happened, keeps a copy of recent logs for the user to read or copy,
 * and offers a restart of the tree rather than a dead end.
 */

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logger.error(`Unhandled render error: ${error.message}`, error);
    logger.error(`Component stack: ${info.componentStack ?? 'unknown'}`);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <AppText variant="title">LifeOS hit a problem</AppText>
        <Spacer size="sm" />
        <AppText tone="muted">
          Your data is stored on this device and has not been lost. You can try again.
        </AppText>
        <Spacer size="lg" />
        <Button label="Try again" onPress={this.reset} />

        <Spacer size="lg" />
        <AppText variant="caption" tone="faint">
          Details (safe to share when reporting a problem):
        </AppText>
        <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>
          <AppText variant="micro" tone="faint" selectable>
            {logger
              .recent(20)
              .map((r) => `${new Date(r.timestamp).toISOString()} ${r.level} ${r.message}${r.error ? ` — ${r.error}` : ''}`)
              .join('\n')}
          </AppText>
        </ScrollView>
        <Spacer size="sm" />
        <Button label="Restart with logging off" variant="ghost" onPress={() => setConsoleLogging(false)} />
      </View>
    );
  }
}
