import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/*.test.ts'],
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
        },
      },
    ],
  },
};

export default config;
