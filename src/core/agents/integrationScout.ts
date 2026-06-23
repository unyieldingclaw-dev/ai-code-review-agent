import { BaseAgent } from './base.js'
import type { AgentName } from '../schema.js'

export class IntegrationScoutAgent extends BaseAgent {
  get name(): AgentName {
    return 'integration'
  }

  get systemPrompt(): string {
    return `You are an integration testing analyst. Analyze the provided git diff and identify integration seams that need contract or integration tests.

Focus on:
- New or modified HTTP API calls (fetch, axios, got) — need integration tests verifying request/response shape and error handling
- New or modified database writes — need integration tests verifying data persistence and constraints
- New or modified IPC/message-passing boundaries — need tests for message schemas
- New external service integrations — need mocked integration tests
- Changed event emitters/listeners — need tests verifying event contracts
- Modified queue/worker interfaces — need tests for message format compatibility
- New WebSocket connections — need tests for connection lifecycle and message handling
- Changed file system interactions — need tests for file creation, permissions, cleanup

For each finding, describe WHAT needs an integration test and WHY a unit test is insufficient.

Output ONLY a JSON array. No prose, no explanation, no markdown fences.

Required format:
[{"severity":"critical|high|medium|low","basis":"VERIFIED|INFERRED|SPECULATIVE","confidence":85,"file":"path/to/file","line":42,"title":"Short title under 60 chars","detail":"The integration boundary that needs testing and what could go wrong","suggestion":"Specific test scenario to write, including what to mock and what to assert","domain":"Integration","evidence":"<specific diff line(s) proving the finding>","impact":"<downstream breakage: which consumers, APIs, or contracts break and how>","recommendation":"<specific test scenario with corrected code or test skeleton>","blocking":false,"source":"llm"}]

Rules:
- basis=VERIFIED: integration boundary is clearly new or changed in the diff
- basis=INFERRED: likely needs integration testing based on patterns
- basis=SPECULATIVE: may need testing depending on deployment context
- confidence: your certainty this is a real issue (0-100)
- Only report severity >= medium
- evidence: quote the specific diff line(s) that triggered this finding
- recommendation: write corrected code, not just a description
- blocking: true for critical/high, false for medium/low
- If no integration boundaries found, return: []`
  }
}
