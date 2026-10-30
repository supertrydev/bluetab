import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Phase 9 — include .test.tsx so component tests (e.g.
  // SuspendedTabsSection.test.tsx gated-close contract) run alongside
  // the existing .test.ts service/utility tests.
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/src/utils/test-helpers/jest-setup.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          // Use commonjs for Jest (Node environment)
          module: 'commonjs',
          moduleResolution: 'node',
          // Relax strict settings that conflict with test helpers
          noUnusedLocals: false,
          noUnusedParameters: false,
          // Allow importing without extensions in tests
          allowImportingTsExtensions: false,
          resolveJsonModule: true,
        },
      },
    ],
  },
};

export default config;
