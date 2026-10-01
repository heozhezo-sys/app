/**
 * LifeOS test configuration.
 *
 * Two projects run in a single `jest` invocation:
 *
 * 1. `node`   — pure business logic, repositories, migrations and services.
 *               Migrations execute against real SQLite via Node 22's built-in
 *               `node:sqlite`, so the SQL shipped to the device is the SQL tested.
 * 2. `expo`   — React Native component/hook tests through `jest-expo`.
 */
module.exports = {
  projects: [
    {
      displayName: 'node',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts', '<rootDir>/tests/integration/**/*.test.ts'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        // `expo-sqlite` is a native module and cannot load in Node. The real driver is
        // injected via `__setDatabaseHandleForTests`, so only the module shape matters.
        '^expo-sqlite$': '<rootDir>/tests/support/expoSqliteStub.ts',
        // Same story for the filesystem: the SDK 57 object API is reproduced by a fake
        // so the storage adapter's real logic is tested off-device.
        '^expo-file-system$': '<rootDir>/tests/support/expoFileSystemStub.ts',
      },
      setupFiles: ['<rootDir>/tests/setup/node.setup.ts'],
    },
    {
      displayName: 'expo',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/tests/ui/**/*.test.tsx'],
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
      ],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
      },
      setupFiles: ['<rootDir>/tests/setup/expo.setup.ts'],
    },
  ],
};
