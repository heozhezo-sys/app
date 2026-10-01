/**
 * Setup for the `expo` (component/hook) test project.
 */

// React Native Testing Library ships its matchers by default in current versions,
// so no `extend-expect` import is needed here.

// Silence the Reanimated "useNativeDriver" advice noise in the test renderer.
jest.mock('react-native-reanimated', () => {
  const Reanimated = jest.requireActual('react-native-reanimated/mock');
  Reanimated.default.call = () => undefined;
  return Reanimated;
});

jest.setTimeout(20_000);

export {};
