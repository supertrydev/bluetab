// ESLint 9 flat config. Same rules as the former .eslintrc.cjs (ESLint 8).
//
// package.json overrides minimatch to >=11.0.1 (security fix). eslint-plugin-react
// still calls minimatch as a function in five rules that are NOT enabled here:
// forbid-component-props, jsx-handler-names, jsx-pascal-case, no-danger,
// no-unstable-nested-components. Do not enable them until the plugin supports
// minimatch 11. ESLint 10 waits for eslint-plugin-react support as well.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['dist/', 'dist-firefox/', 'node_modules/', 'coverage/', 'release/'],
  },
  {
    // ESLint 8 did not report unused eslint-disable comments; keep it that way.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  reactHooks.configs['recommended-latest'],
  {
    files: ['**/*.{js,jsx,ts,tsx,cjs,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.jest,
        ...globals.node,
        ...globals.webextensions,
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-case-declarations': 'off',
      'no-constant-condition': 'off',
      'no-control-regex': 'off',
      'no-extra-semi': 'off',
      'no-useless-escape': 'off',
      'prefer-const': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      'react/jsx-key': 'off',
    },
  },
);
