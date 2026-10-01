import React from 'react';
import { Redirect } from 'expo-router';

import { useSettingsStore } from '@/stores/settingsStore';
import { StateView , Screen } from '@/components/Layout';


/**
 * Entry gate.
 *
 * The first successful launch is sent to onboarding; after that the app always opens
 * on Today. Settings are already loaded by the time this renders because the root
 * layout blocks on the database before mounting the navigator.
 */
export default function IndexGate(): React.ReactElement {
  const onboardingCompleted = useSettingsStore((state) => state.settings.onboardingCompleted);
  const loaded = useSettingsStore((state) => state.loaded);

  if (!loaded) {
    return (
      <Screen>
        <StateView state="loading" loadingLabel="Opening LifeOS" />
      </Screen>
    );
  }

  return <Redirect href={onboardingCompleted ? '/today' : '/onboarding'} />;
}
