/**
 * Theme access.
 *
 * Components never import the palette directly. They call `useTheme()` so that a
 * theme change (light/dark/system) re-renders them with the correct tokens.
 *
 * This module deliberately has no dependency on the database: the resolved
 * appearance is injected from the app root. That keeps theme usable in tests and
 * prevents a circular dependency theme -> settings store -> database -> theme.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { buildTheme, type Theme } from './index';
import type { AppearancePreference } from '@/types/settings';

export type ResolvedAppearance = 'light' | 'dark';

export function resolveAppearance(
  preference: AppearancePreference,
  systemScheme: ResolvedAppearance | null | undefined,
): ResolvedAppearance {
  if (preference === 'light' || preference === 'dark') return preference;
  // 'system' and any unknown persisted value degrade to the OS scheme, defaulting
  // to light when the OS reports nothing.
  return systemScheme === 'dark' ? 'dark' : 'light';
}

const ThemeContext = createContext<Theme>(buildTheme(false));

export interface ThemeProviderProps {
  preference: AppearancePreference;
  children: React.ReactNode;
  /** Test seam: forces the OS scheme reported to the provider. */
  forcedSystemScheme?: ResolvedAppearance | null;
}

export function ThemeProvider({ preference, children, forcedSystemScheme }: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const effectiveSystemScheme: ResolvedAppearance | null | undefined =
    forcedSystemScheme === undefined
      ? systemScheme === 'dark' || systemScheme === 'light'
        ? systemScheme
        : // `unspecified` and `null` mean the OS told us nothing usable.
          null
      : forcedSystemScheme;

  const resolved = resolveAppearance(preference, effectiveSystemScheme);
  const theme = useMemo(() => buildTheme(resolved === 'dark'), [resolved]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
