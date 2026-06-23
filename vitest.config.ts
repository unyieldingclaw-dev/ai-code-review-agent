import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // WHY: vscode-extension tests require the VS Code test host — they cannot run under vitest
    exclude: ['**/node_modules/**', 'vscode-extension/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli/**', 'src/adapters/**'],
    },
  },
})
