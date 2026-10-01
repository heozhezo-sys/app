import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme , View } from 'react-native';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppText } from '@/components/AppText';
import { Spacer } from '@/components/Button';
import { getDatabase } from '@/database/database';
import * as booksService from '@/services/booksService';
import * as focusService from '@/services/focusService';
import * as notificationService from '@/services/notificationService';
import * as achievementsService from '@/services/achievementsService';
import { ThemeProvider, resolveAppearance } from '@/theme/ThemeProvider';
import { useSettingsStore } from '@/stores/settingsStore';
import { logger, setConsoleLogging } from '@/utils/logger';


// Release builds do not write to the console; the in-app buffer is kept either way.
if (!__DEV__) setConsoleLogging(false);

void SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden, or unsupported on this platform. Never fatal.
});

type BootState =
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'failed'; message: string };

function useBootstrap(): BootState {
  const [state, setState] = useState<BootState>({ phase: 'loading' });
  const loadSettings = useSettingsStore((s) => s.load);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await getDatabase();
        await loadSettings();
        // Housekeeping only: removes PDFs left behind by an import that was killed
        // part way through, resolves a focus session whose deadline passed while the app
        // was closed, re-arms reminders the OS dropped on a previous update, and counts
        // anything earned while the app was closed. None throws, so none can delay or
        // block launch.
        void booksService.sweepInterruptedImports();
        void focusService.recoverStaleSession();
        void notificationService.rehydrate();
        void achievementsService.evaluate();
        if (!cancelled) setState({ phase: 'ready' });
      } catch (error) {
        // A database that cannot open is a stop condition, not something to retry
        // blindly: the app shows the reason and never pretends to have data.
        logger.error('Bootstrap failed', error);
        if (!cancelled) {
          setState({
            phase: 'failed',
            message:
              error instanceof Error
                ? error.message
                : 'The local database could not be opened.',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadSettings]);

  return state;
}

function BootFailure({ message }: { message: string }): React.ReactElement {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  return (
    <SafeAreaProvider>
      <ThemeProvider preference={isDark ? 'dark' : 'light'}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ErrorBoundary>
          <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
            <AppText variant="title">LifeOS could not start</AppText>
            <Spacer size="sm" />
            <AppText tone="muted">
              Your data on this device has not been modified. Restarting usually fixes a
              temporary problem, such as the device being out of storage.
            </AppText>
            <Spacer size="lg" />
            <AppText variant="caption" tone="faint" selectable>
              {message}
            </AppText>
          </View>
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default function RootLayout(): React.ReactElement {
  const boot = useBootstrap();
  const appearance = useSettingsStore((s) => s.settings.appearance);
  const systemScheme = useColorScheme();

  // React Native can report 'unspecified'; treat anything but 'dark' as light there.
  const systemAppearance: 'light' | 'dark' | null =
    systemScheme === 'dark' ? 'dark' : systemScheme === 'light' ? 'light' : null;

  useEffect(() => {
    if (boot.phase === 'ready') void SplashScreen.hideAsync().catch(() => undefined);
  }, [boot.phase]);

  if (boot.phase === 'failed') return <BootFailure message={boot.message} />;

  return (
    <SafeAreaProvider>
      <ThemeProvider preference={appearance}>
        <StatusBar style={resolveAppearance(appearance, systemAppearance) === 'dark' ? 'light' : 'dark'} />
        <ErrorBoundary>
          <Stack
            screenOptions={{
              headerShown: true,
              headerBackButtonDisplayMode: 'minimal',
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="manage" options={{ title: 'Habits' }} />
            <Stack.Screen name="habit/[id]" options={{ title: 'Habit' }} />
            <Stack.Screen name="goal/[id]" options={{ title: 'Goal' }} />
            <Stack.Screen name="workout/[id]" options={{ title: 'Workout' }} />

            {/*
              Secondary modules, reached from Today and from Settings. They are Stack
              screens rather than tabs because `UI_UX/NAVIGATION.md` names five primary
              tabs and everything else belongs behind a hub — and because a tab bar with
              fifteen entries would stop being a command centre.
            */}
            <Stack.Screen name="recovery" options={{ title: 'Recovery' }} />
            <Stack.Screen name="achievements" options={{ title: 'Achievements' }} />
            <Stack.Screen name="analytics" options={{ title: 'Analytics' }} />
            <Stack.Screen name="calendar" options={{ title: 'Calendar' }} />

            <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
            <Stack.Screen name="settings/appearance" options={{ title: 'Appearance' }} />
            <Stack.Screen name="settings/units" options={{ title: 'Units' }} />
            <Stack.Screen name="settings/currency" options={{ title: 'Currency' }} />
            <Stack.Screen name="settings/reminders" options={{ title: 'Reminders' }} />
            <Stack.Screen name="settings/privacy" options={{ title: 'Privacy' }} />
            <Stack.Screen name="settings/data" options={{ title: 'Data' }} />
          </Stack>
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
