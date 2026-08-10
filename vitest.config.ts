import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // WHY: vscode-extension tests require the VS Code test host — they cannot run under vitest.
    // .claude/worktrees/** holds isolated-agent git worktrees (full repo checkouts) -- without
    // excluding it, vitest's default glob picks up their tests/ copy too and runs it in parallel
    // with the real suite, racing on shared absolute temp paths (e.g. contextLoader.test.ts's
    // .test-context-tmp) and producing spurious failures unrelated to any real code change.
    exclude: ['**/node_modules/**', 'vscode-extension/**', '.claude/worktrees/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.ts'],
    },
  },
})
