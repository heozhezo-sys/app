import React from 'react';
import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Primary navigation.
 *
 * Only implemented destinations appear. Shipping tab entries for screens that do not
 * exist yet would be a placeholder, and the specification forbids placeholders
 * disguised as finished work. Tabs are added as their vertical slice completes.
 */
export default function TabsLayout(): React.ReactElement {
  const theme = useTheme();

  const label = (text: string) =>
    function TabLabel({ color }: { color: ColorValue }): React.ReactElement {
      return (
        <AppText variant="micro" style={{ color }}>
          {text}
        </AppText>
      );
    };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textFaint,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarLabel: label('Today') }} />
      <Tabs.Screen name="habits" options={{ title: 'Habits', tabBarLabel: label('Habits') }} />
      <Tabs.Screen name="goals" options={{ title: 'Goals', tabBarLabel: label('Goals') }} />
      <Tabs.Screen name="fitness" options={{ title: 'Fitness', tabBarLabel: label('Fitness') }} />
      <Tabs.Screen name="focus" options={{ title: 'Focus', tabBarLabel: label('Focus') }} />
      <Tabs.Screen name="books" options={{ title: 'Books', tabBarLabel: label('Books') }} />
      <Tabs.Screen name="hydration" options={{ title: 'Water', tabBarLabel: label('Water') }} />
      <Tabs.Screen name="nutrition" options={{ title: 'Food', tabBarLabel: label('Food') }} />
      <Tabs.Screen name="journal" options={{ title: 'Journal', tabBarLabel: label('Journal') }} />
      <Tabs.Screen name="sleep" options={{ title: 'Sleep', tabBarLabel: label('Sleep') }} />
      <Tabs.Screen name="finance" options={{ title: 'Finance', tabBarLabel: label('Finance') }} />
    </Tabs>
  );
}

