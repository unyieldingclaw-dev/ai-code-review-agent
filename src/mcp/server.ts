#!/usr/bin/env node
// src/mcp/server.ts
//
// MCP server entry point for ai-review-mcp.
// Exposes the review_diff tool over stdio transport.
//
// WHY stdio: Cursor spawns local MCP servers as child processes and communicates
// over stdin/stdout. All diagnostic output must go to stderr — stdout is the
// MCP protocol channel.

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import { runReviewTool } from './tool.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as {
  version: string
}

const server = new Server({ name: 'ai-review', version }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'review_diff',
      description:
        'Run the AI code review swarm on the current git diff. ' +
        'Uses 15 specialist agents (security, performance, correctness, design, ' +
        'dependencies, adversarial, integration, breaking-change, license, coverage, ' +
        'error-handling, observability, migration-safety, secrets, complexity) ' +
        'powered by Ollama locally — no API costs, fully offline. ' +
        'Returns a markdown summary with full detail for critical/high findings.',
      inputSchema: {
        type: 'object',
        properties: {
          repo_path: {
            type: 'string',
            description:
              'Absolute path to the repository root. ' +
              "Defaults to the server's working directory (Cursor sets this to the workspace root).",
          },
        },
        required: [],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'review_diff') {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`)
  }

  const args = (request.params.arguments ?? {}) as { repo_path?: string }

  try {
    const text = await runReviewTool({ repo_path: args.repo_path })
    return { content: [{ type: 'text', text }] }
  } catch (err) {
    // runReviewTool catches and formats errors itself — this is a safety net only.
    const msg = err instanceof Error ? err.message : String(err)
    return { content: [{ type: 'text', text: `## AI Code Review\n\nUnexpected error: ${msg}` }] }
  }
})

// WHY: process.stderr for diagnostics — stdout is reserved for the MCP protocol.
process.stderr.write('[ai-review-mcp] Server starting...\n')

const transport = new StdioServerTransport()
await server.connect(transport)

process.stderr.write('[ai-review-mcp] Server ready.\n')

// Clean up when the MCP client disconnects or the process is terminated.
// Without these handlers the server stays alive as a zombie with any in-flight
// Ollama calls still running.
const shutdown = (): void => {
  process.stderr.write('[ai-review-mcp] Shutting down.\n')
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
process.stdin.on('end', shutdown)
process.stdin.on('close', shutdown)
