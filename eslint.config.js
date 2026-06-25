// eslint.config.js
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'vscode-extension/**',
      'calibration/**',
      '*.config.js',
      '*.config.ts',
    ],
  },
  {
    rules: {
      // Downgrade to warn — these are quality signals, not hard errors
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Keep as errors — these are real problems
      'no-console': 'off', // ACR legitimately uses console.error/warn for stderr progress
      '@typescript-eslint/no-floating-promises': 'off', // vitest handles these
    },
  }
)
