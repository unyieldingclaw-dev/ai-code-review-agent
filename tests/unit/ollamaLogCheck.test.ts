import { readFileSync } from 'fs'
import { describe, it, expect, vi } from 'vitest'
import {
  parseDurationMs,
  analyzeLog,
  analyzeLogs,
  checkWindow,
  renderText,
  toWall,
  main,
  wallMs,
  type RequestRecord,
  type LogReport,
} from '../../calibration/ollamaLogCheck.js'

// Every fixture is a contiguous slice of a real Ollama server log -- 0.34.x, except runner-crash
// (0.35.0) and cancel-before-500 (0.40.4) -- edited only to remove identifying details: the Windows
// username became `user` everywhere, and in the four slices that include a model load (aborted-load,
// devstral-load-and-request, cold-load-short-answer, runner-crash) the GPU model became `GPU-0`, its
// PCI address `0000:00:00.0`, the CPU model `CPU-0`, and the RAM and VRAM totals x's. The free and
// available memory the parser reads were left as logged. No parsed value was touched. Every
// expected value below was read by hand from those raw lines -- the
// line numbers cited are fixture line numbers -- and NOT taken from any parser's output, because a
// known answer produced by the code under test (or by its prototype) cannot catch that code's bugs.
const fixture = (name: string): string[] =>
  readFileSync(`tests/fixtures/ollama-log/${name}`, 'utf-8').split(/\r?\n/)

const chat = (report: LogReport, endLocal: string, duration: string): RequestRecord => {
  const found = report.requests.filter(
    (r) => r.end === wallMs(endLocal) && r.durationText === duration
  )
  expect(found, `exactly one chat request ending ${endLocal} after ${duration}`).toHaveLength(1)
  return found[0]
}

describe('parseDurationMs', () => {
  it.each([
    ['5m0s', 300_000],
    ['3m27s', 207_000],
    ['10.7321013s', 10_732.1013],
    ['47.235ms', 47.235],
    ['999µs', 0.999], // the real bytes: U+00B5 MICRO SIGN, as Go prints it
    ['502.4µs', 0.5024],
    ['1h2m3s', 3_723_000],
    ['0s', 0],
  ])('%s -> %d ms', (text, ms) => {
    expect(parseDurationMs(text)).toBeCloseTo(ms, 6)
  })

  // A duration the parser cannot read must stop the check. Reading it as 0 would turn an
  // unparseable request into an "instant" one -- a false clean verdict, not an error.
  it.each(['12 parsecs', '', '5m0'])('rejects %j instead of reading it as 0', (text) => {
    expect(() => parseDurationMs(text)).toThrow(/unrecognized duration/)
  })
})

describe('queue-bound recall trials 6-8 (2026-09-18, devstral, 300 s budget)', () => {
  const report = analyzeLog(fixture('queue-bound-trials-6-8.log'))

  // Trial 6 -- lines 157-191. Arrived 18:47:11 - 300 s = 18:42:11. Task 9760's "new prompt"
  // (line 183) follows the 18:46:52 request line (157), so it cannot have started before 18:46:52:
  // waited AT LEAST 281 s, computed AT MOST 19 s. Stop line: n_tokens 1239 - prompt 1178 = 61.
  it('trial 6 waited at least 281 s of its 300 s and generated 61 tokens', () => {
    const r = chat(report, '2026-09-18T18:47:11', '5m0s')
    expect(r.kind).toBe('cancelled')
    expect(r.taskIds).toEqual([9760])
    expect(r.minWaitBeforeStartMs).toBe(281_000)
    expect(r.maxComputeMs).toBe(19_000)
    expect(r.generatedTokens).toBe(61)
    expect(r.promptCacheMs).toBeCloseTo(4730.28, 2)
    // Line 186: 1177 of its 1178 prompt tokens came from the prompt cache (a warm prefill).
    expect(r.cachedPromptTokens).toBe(1177)
    expect(r.dominant).toBe('queue')
  })

  // Trial 7 -- lines 300-333. Arrived 18:47:13; task 10581 (line 325) follows the 18:52:01 line.
  it('trial 7 waited at least 288 s and generated 42 tokens', () => {
    const r = chat(report, '2026-09-18T18:52:13', '5m0s')
    expect(r.taskIds).toEqual([10581])
    expect(r.minWaitBeforeStartMs).toBe(288_000)
    expect(r.maxComputeMs).toBe(12_000)
    expect(r.generatedTokens).toBe(42)
    expect(r.dominant).toBe('queue')
  })

  // Trial 8 -- lines 491-526. Task 11336 was cancelled (503) before it ever launched (523) and has
  // no "new prompt" line at all. Its stop line reads n_tokens = 1220, but that is the slot's
  // leftover state from trial 7 (1178 + 42), not output: stop-minus-prompt is only valid for a
  // task that actually started.
  it('trial 8 never started: waited the whole 300 s and generated nothing', () => {
    const r = chat(report, '2026-09-18T18:57:14', '5m0s')
    expect(r.taskIds).toEqual([11336])
    expect(r.started).toBe(false)
    expect(r.minWaitBeforeStartMs).toBe(300_000)
    expect(r.maxComputeMs).toBe(0)
    expect(r.generatedTokens).toBe(0)
    expect(r.dominant).toBe('queue')
  })

  // The other client's request -- lines 23-161. Arrived 18:46:52 - 307 s = 18:41:45; task 9082
  // (line 23) follows the 18:42:10 line; stop n_tokens 17890 - prompt 17246 = 644.
  it("attributes the other client's own timeout to generation, not queue", () => {
    const r = chat(report, '2026-09-18T18:46:52', '5m7s')
    expect(r.taskIds).toEqual([9082])
    expect(r.minWaitBeforeStartMs).toBe(25_000)
    expect(r.generatedTokens).toBe(644)
    expect(r.dominant).toBe('generation')
  })

  it('does not invent a task for a request whose task finished before the log slice began', () => {
    const r = chat(report, '2026-09-18T18:42:10', '3m27s')
    expect(r.kind).toBe('unlinked')
    expect(r.taskIds).toEqual([])
  })

  it('flags the overlap between trial 6 and the other client as contention', () => {
    const w = checkWindow(report, wallMs('2026-09-18T18:42:10'), wallMs('2026-09-18T18:48:00'))
    expect(w.contention).toBe(true)
    const trial6 = chat(report, '2026-09-18T18:47:11', '5m0s')
    const other = chat(report, '2026-09-18T18:46:52', '5m7s')
    expect(w.overlaps).toContainEqual([other, trial6])
  })
})

describe('mixed recall trial 11 (2026-09-18 19:09:24)', () => {
  // Lines 1-89. Arrived 19:04:24; task 13476 (line 28) follows the 19:06:19 line (1).
  // Stop n_tokens 2049 - prompt 1178 = 871, still generating when cut off.
  it('waited at least 115 s, then generated 871 tokens in at most 185 s', () => {
    const r = chat(analyzeLog(fixture('mixed-trial-11.log')), '2026-09-18T19:09:24', '5m0s')
    expect(r.taskIds).toEqual([13476])
    expect(r.minWaitBeforeStartMs).toBe(115_000)
    expect(r.maxComputeMs).toBe(185_000)
    expect(r.generatedTokens).toBe(871)
    expect(r.dominant).toBe('generation')
  })
})

describe('generation-bound ornith timeout (2026-09-18 20:07:56)', () => {
  const report = analyzeLog(fixture('generation-bound-ornith.log'))

  // Lines 4-139. Arrived 20:02:56; task 21688 (line 31) follows the 20:02:56 /api/show line (4).
  // Stop n_tokens 9524 - prompt 1200 = 8324. Sampler params at lines 25-29.
  it('spent no time waiting and ran out of time generating 8324 tokens', () => {
    const r = chat(report, '2026-09-18T20:07:56', '5m0s')
    expect(r.taskIds).toEqual([21688])
    expect(r.minWaitBeforeStartMs).toBe(0)
    expect(r.generatedTokens).toBe(8324)
    expect(r.dominant).toBe('generation')
    expect(report.tasks.get(r.taskKeys[0])?.sampler).toEqual({
      temp: 0.8,
      topK: 40,
      topP: 0.9,
      presencePenalty: 0,
    })
  })

  // Line 1 ended 20:02:55; line 137's request arrived 20:02:56. Back-to-back is not contention,
  // even though second-resolution timestamps make the gap look like 1 s either way.
  it('does not report back-to-back sequential requests as contention', () => {
    const w = checkWindow(report, wallMs('2026-09-18T20:02:55'), wallMs('2026-09-18T20:07:57'))
    expect(w.contention).toBe(false)
    expect(w.overlaps).toEqual([])
  })
})

describe('input truncation (2026-09-17 19:50:06)', () => {
  const report = analyzeLog(fixture('input-truncation.log'))

  // Line 2 records the cut; task 3876 (line 23) is the request that received the cut prompt.
  it('records the silent cut and ties it to the request that received it', () => {
    expect(report.inputTruncations).toEqual([
      { at: wallMs('2026-09-17T19:50:06.096'), limit: 16387, originalTokens: 34075 },
    ])
    const r = chat(report, '2026-09-17T19:50:46', '41.2053081s')
    expect(r.kind).toBe('completed')
    expect(r.taskIds).toEqual([3876])
    expect(r.inputTruncated).toEqual({ limit: 16387, originalTokens: 34075 })
    expect(r.prefillMs).toBeCloseTo(36893.25, 2)
    expect(r.prefillTokens).toBe(16382)
    expect(r.evalMs).toBeCloseTo(941.62, 2)
    expect(r.generatedTokens).toBe(3)
    // Arrived 19:50:46 - 41.2 s = 19:50:04.8 and could not start before 19:50:06.096 (line 2):
    // ~1.3 s of wait against 36.9 s of prompt processing and 0.9 s of generation.
    expect(r.dominant).toBe('prefill')
  })
})

describe('context-full stop (2026-09-21 12:56:46, qwen3.5:9b)', () => {
  const report = analyzeLog(fixture('context-full.log'))

  // One HTTP request, two llama-server tasks. Task 24549 (prompt 31589, line 38) was cancelled at
  // line 174 with NO client request line before it -- the server stopped it near the context limit
  // -- and resubmitted as task 25259 (prompt 32232 = 31589 + the 643 tokens already generated),
  // which filled the context (line 209: n_tokens = 32767, truncated = 1). The request line (211)
  // is the only one for both.
  it('links both tasks of a server-side continuation to the one request', () => {
    const r = chat(report, '2026-09-21T12:56:46', '1m28s')
    expect(r.taskIds).toEqual([24549, 25259])
    expect(r.contextFull).toBe(true)
    const [first, second] = r.taskKeys.map((k) => report.tasks.get(k)!)
    expect(first.serverCancelled).toBe(true)
    expect(first.promptTokens).toBe(31589)
    expect(second.truncated).toBe(true)
    expect(second.evalTokens).toBe(536)
    expect(second.sampler).toEqual({ temp: 1, topK: 20, topP: 0.95, presencePenalty: 1.5 })
    // 32234 - 31589 = 645 from the first task, plus 536 counted by the second task's eval line.
    expect(r.generatedTokens).toBe(645 + 536)
  })
})

describe('model load and a cold first request (2026-09-25, devstral, Ollama 0.34.4)', () => {
  const report = analyzeLog(fixture('devstral-load-and-request.log'))

  it('reads the execution envelope the API does not expose', () => {
    expect(report.loads).toHaveLength(1)
    expect(report.loads[0]).toMatchObject({
      blob: 'b3a2c9a8fef9be8d2ef951aecca36a36b9ea0b70abe9359eab4315bf4cd9be01',
      ctxArg: 32768,
      parallel: 1,
      ok: true,
      loadSeconds: 23.08,
      gpuLayers: '12/41',
      nCtx: 32768,
      nCtxTrain: 131072,
      kvCpuMiB: 3712,
      kvGpuMiB: 1408,
      kvType: 'f16',
      flashAttention: 'enabled',
      speculative: 'none',
      systemFree: '7.8 GiB',
      gpuAvailable: '6.4 GiB',
    })
  })

  // Arrived 22:37:46 - 102 s = 22:36:04; the load began 22:36:04.928 and took 23.08 s; task 0's
  // "new prompt" (line 254) follows the 22:36:28.022 line (239). Prefill 15468.19 ms, generation
  // 62688.70 ms / 304 tokens. The 24 s before start was the load, not a queue.
  it('separates load time from queue wait on a cold start', () => {
    const r = chat(report, '2026-09-25T22:37:46', '1m42s')
    expect(r.kind).toBe('completed')
    expect(r.taskIds).toEqual([0])
    expect(r.loadMsDuringWait).toBe(23_080)
    expect(r.prefillMs).toBeCloseTo(15468.19, 2)
    expect(r.evalMs).toBeCloseTo(62688.7, 2)
    expect(r.generatedTokens).toBe(304)
    // Line 255: nothing cached -- a cold prefill of all 5658 tokens.
    expect(r.cachedPromptTokens).toBe(0)
    expect(r.dominant).toBe('generation')
  })
})

describe('load-bound cold start with a short answer (2026-09-19 16:55:26)', () => {
  // Arrived 16:55:26 - 25.0923048 s = 16:55:00.908; the load began 16:55:02.411 (line 5) and took
  // 21.43 s (236); task 0's "new prompt" (255) follows the 16:55:23.898 line (240). So at least
  // 22,990 ms passed before the task started, 21,430 of them loading: ~1.6 s of queue. Prefill
  // 2308.25 ms (259, capped at the 2.1 s left after the start), generation 250.49 ms / 2 tokens.
  const r = chat(
    analyzeLog(fixture('cold-load-short-answer.log')),
    '2026-09-19T16:55:26',
    '25.0923048s'
  )

  it('attributes the wait to the load, not to a queue', () => {
    expect(r.taskIds).toEqual([0])
    expect(r.minWaitBeforeStartMs).toBeCloseTo(22_990.3, 0)
    expect(r.loadMsDuringWait).toBe(21_430)
    expect(r.cachedPromptTokens).toBe(0)
    expect(r.generatedTokens).toBe(2)
    expect(r.dominant).toBe('load')
  })
})

describe('task ids restart at 0 with every model load', () => {
  // The same real slice twice in a row: two loads, each followed by a request served by that
  // server's "task 0". A parser keying tasks by id alone would give the second request nothing.
  it("links each request to its own server's task 0", () => {
    const once = fixture('devstral-load-and-request.log')
    const report = analyzeLog([...once, ...once])
    const served = report.requests.filter((r) => r.endpoint === '/api/chat')
    expect(served).toHaveLength(2)
    for (const r of served) {
      expect(r.taskIds).toEqual([0])
      expect(r.generatedTokens).toBe(304)
    }
    expect(new Set(served.map((r) => r.taskKeys[0])).size).toBe(2)
  })
})

describe('aborted load (2026-09-25 23:43, a client giving up after ~10.7 s)', () => {
  const report = analyzeLog(fixture('aborted-load.log'))

  it('classifies a request cancelled mid-load as load-bound, with no task', () => {
    expect(report.loads[0]).toMatchObject({ ok: false, aborted: true })
    const r = chat(report, '2026-09-25T23:43:30', '10.7321013s')
    expect(r.kind).toBe('load-aborted')
    expect(r.taskIds).toEqual([])
    expect(r.dominant).toBe('load')
  })

  it('names a model the run did not ask for', () => {
    const w = checkWindow(report, wallMs('2026-09-25T23:43:20'), wallMs('2026-09-25T23:43:31'), {
      expectedBlob: 'dec52a44569a',
    })
    expect(w.foreignModels).toEqual([
      'b3a2c9a8fef9be8d2ef951aecca36a36b9ea0b70abe9359eab4315bf4cd9be01',
    ])
    expect(w.contention).toBe(true)
  })
})

// The three cases below were found by replaying the whole preserved Sep 15-24 log through the
// parser, not by picking fixtures: 170 of 2063 chat requests came back unlinked, and these are the
// real orderings that caused it.
describe('log orderings that are not strictly request-then-cancel-then-release', () => {
  // Lines 1-6: the next client's /api/tags request is logged BETWEEN this request's 500 and the
  // cancel of its task. Task 8490 started before the slice, so only the link is knowable.
  it('links a cancel that arrives after an unrelated request line', () => {
    const r = chat(analyzeLog(fixture('cancel-after-next-ping.log')), '2026-09-18T18:41:44', '5m7s')
    expect(r.kind).toBe('cancelled')
    expect(r.taskIds).toEqual([8490])
    expect(r.minWaitBeforeStartMs).toBeUndefined()
  })

  // cancel-before-500.log, a real Ollama 0.40.4 slice (2026-10-19): task 887's cancel (line 117) is
  // logged BEFORE its own request's 500 (118, ending 15:03:06 after 3m44s), with no failed request
  // waiting for it -- the same shape as a server-side continuation (context-full.log). It is not
  // one: the next line that could own it is a failed request line, not a new task's launch (task
  // 1721 launches only at 143, for the request ending 15:06:57). Read as a continuation, task 887
  // was handed to that next request (cached=848 gen=1669 for one 3m44s request) and the timed-out
  // trial's own window was refused as an unreadable log.
  it('links a cancel logged before its own request line to that request', () => {
    const report = analyzeLog(fixture('cancel-before-500.log'))
    const timedOut = chat(report, '2026-10-19T15:03:06', '3m44s')
    expect(timedOut.kind).toBe('cancelled')
    expect(timedOut.taskIds).toEqual([887])
    expect(timedOut.cachedPromptTokens).toBe(848) // line 28
    expect(timedOut.generatedTokens).toBe(10571 - 9757) // lines 119, 27
    const next = chat(report, '2026-10-19T15:06:57', '3m44s')
    expect(next.taskIds).toEqual([1721])
    expect(next.cachedPromptTokens).toBe(788) // line 145
    expect(next.generatedTokens).toBe(10552 - 9697) // lines 239, 144
    const w = checkWindow(report, wallMs('2026-10-19T14:59:22'), wallMs('2026-10-19T15:03:06'))
    expect(w.contention).toBe(false)
  })

  // Lines 22-33: a sub-second request's 200 is logged BEFORE its task's timing and release lines
  // -- llama-server's output reaches the log through a pipe and can lag Ollama's own lines.
  it("links a fast request to its task even when the task's release is logged after it", () => {
    const r = chat(
      analyzeLog(fixture('fast-200-before-release.log')),
      '2026-09-21T15:17:39',
      '893.4614ms'
    )
    expect(r.kind).toBe('completed')
    expect(r.taskIds).toEqual([4563])
    expect(r.prefillMs).toBeCloseTo(628.81, 2)
    expect(r.prefillTokens).toBe(130)
    expect(r.generatedTokens).toBe(2)
  })

  // Lines 64-131: task 5329 released (64) before its 200 (66, ending 11:18:38 after 48.48 s);
  // the next request arrived 11:19:23 - 45.58 s = 11:18:37.42 and its task started (91) only
  // after 5329 released. At second resolution they appear to overlap by 0.58 s; they did not
  // contend.
  it('does not report a sub-second apparent overlap between sequential requests', () => {
    const report = analyzeLog(fixture('back-to-back-requests.log'))
    const first = chat(report, '2026-09-18T11:18:38', '48.4779937s')
    const second = chat(report, '2026-09-18T11:19:23', '45.578784s')
    expect(first.taskIds).toEqual([5329])
    expect(second.taskIds).toEqual([5477])
    const w = checkWindow(report, wallMs('2026-09-18T11:17:49'), wallMs('2026-09-18T11:19:23'))
    expect(w.overlaps).toEqual([])
    expect(w.contention).toBe(false)
  })
})

describe('a request abandoned while still queued inside Ollama (2026-09-21 16:04:10)', () => {
  // Line 3: Ollama logs the client giving up; line 4 is that request's 500 after 10.0 s. No
  // llama-server task was ever created for it -- task 9045 (another client's 29,946-token request,
  // released at line 10, answered at line 12) held the only slot throughout. In the whole Sep 15-24
  // log this line appears 154 times, once for each 500 that had no task.
  const report = analyzeLog(fixture('abandoned-in-queue.log'))

  it('classifies it as never started, all of its time spent queued', () => {
    const r = chat(report, '2026-09-21T16:04:10', '10.0070865s')
    expect(r.kind).toBe('queued-abandoned')
    expect(r.taskIds).toEqual([])
    expect(r.started).toBe(false)
    expect(r.minWaitBeforeStartMs).toBeCloseTo(10_007.0865, 3)
    expect(r.generatedTokens).toBe(0)
    expect(r.dominant).toBe('queue')
  })

  it('counts it as an explained request and reports the contention', () => {
    const w = checkWindow(report, wallMs('2026-09-21T16:04:00'), wallMs('2026-09-21T16:04:15'))
    expect(w.contention).toBe(true)
  })
})

describe('failed requests pending together (2026-09-19 20:03:14)', () => {
  // Lines 29, 31, 33: three /api/chat 500s logged in the same second, each after ~10 s, BEFORE any
  // of their cancels (36, 69, 104). One task (16167) was running; 16226 and 16227 launched and
  // were cancelled only afterwards. Second-resolution request lines and untimestamped task lines
  // cannot say which task was whose, so the pairing below rests on log order alone.
  const report = analyzeLog(fixture('simultaneous-failures.log'))

  it('marks every request whose task was assigned by log order alone', () => {
    for (const d of ['9.9965375s', '9.998822s', '9.99525s']) {
      expect(chat(report, '2026-09-19T20:03:14', d).pairedByLogOrder).toBe(true)
    }
  })

  it('says so in the window check', () => {
    const w = checkWindow(report, wallMs('2026-09-19T20:03:04'), wallMs('2026-09-19T20:03:15'))
    expect(w.warnings.some((x) => /3 request\(s\) paired .* by log order/.test(x))).toBe(true)
  })

  // Guard: in trials 6-8 each cancel arrived while only ONE failed request was pending (the two
  // 18:57:14 failures at lines 491 and 502 were cancelled at 494 and 503), so nothing is flagged.
  it('does not flag a failure whose cancel had only one candidate', () => {
    const q = analyzeLog(fixture('queue-bound-trials-6-8.log'))
    expect(chat(q, '2026-09-18T18:57:14', '5m7s').pairedByLogOrder).toBe(false)
    expect(chat(q, '2026-09-18T18:57:14', '5m0s').pairedByLogOrder).toBe(false)
  })
})

describe('edge cases built from real lines (each synthetic arrangement says what it changed)', () => {
  // Synthetic: abandoned-in-queue.log lines 3-4 twice over -- one abort line moved 0.5 s earlier
  // and one request shortened to 9.5 s -- so two queue abandonments are pending at once. That has
  // not happened in either real log, but nothing prevents it.
  it('explains two requests abandoned in the queue together', () => {
    const [, , abortLine, requestLine] = fixture('abandoned-in-queue.log')
    const report = analyzeLog([
      abortLine.replace('16:04:10.614', '16:04:10.114'),
      abortLine,
      requestLine.replace('10.0070865s', '9.5s'),
      requestLine,
    ])
    expect(chat(report, '2026-09-21T16:04:10', '9.5s').kind).toBe('queued-abandoned')
    expect(chat(report, '2026-09-21T16:04:10', '10.0070865s').kind).toBe('queued-abandoned')
  })

  // Synthetic: cancel-after-next-ping.log with one extra /api/tags line (its own line 3, re-timed to
  // 18:41:50) inserted before the cancel, so the cancel arrives 6 s after the request ended -- past
  // the point where it can belong to that request.
  it('does not pair a cancel that arrives too long after the failed request', () => {
    const lines = fixture('cancel-after-next-ping.log')
    const late = lines[2].replace('18:41:44', '18:41:50')
    const report = analyzeLog([...lines.slice(0, 4), late, ...lines.slice(4)])
    expect(chat(report, '2026-09-18T18:41:44', '5m7s').taskIds).toEqual([])
  })

  // Synthetic: cancel-before-500.log with two lines inserted -- a taskless 404 (line 118 re-statused,
  // 1.2 ms) between task 887's cancel (117) and its 500 (118), and a second 500 (line 118 re-timed
  // to 15:03:20, 10.5 s) after 887's release (119), before task 1721 launches (143). In the real logs
  // every request that owned a cancel logged before its line was a 500; 404s there have no task.
  it('gives a cancel logged before its request line to that 500 only', () => {
    const lines = fixture('cancel-before-500.log')
    const notFound = lines[117].replace('500 |         3m44s', '404 |         1.2ms')
    const another = lines[117].replace('15:03:06', '15:03:20').replace('3m44s', '10.5s')
    const report = analyzeLog([
      ...lines.slice(0, 117),
      notFound,
      ...lines.slice(117, 119),
      another,
      ...lines.slice(119),
    ])
    expect(chat(report, '2026-10-19T15:03:06', '1.2ms').taskIds).toEqual([])
    expect(chat(report, '2026-10-19T15:03:06', '3m44s').taskIds).toEqual([887])
    expect(chat(report, '2026-10-19T15:03:20', '10.5s').taskIds).toEqual([])
  })

  // Synthetic: cancel-before-500.log with 887's release (line 119) moved before its 500 (118) and a
  // chat 200 (line 118 re-statused, 0.8 s) inserted between them. The 200 takes the released,
  // cancelled task as a continuation, as before this rule existed; the 500 must not take it again.
  it('does not give a held cancel to a 500 once another request has taken its task', () => {
    const lines = fixture('cancel-before-500.log')
    const ok = lines[117].replace('500 |         3m44s', '200 |          0.8s')
    const report = analyzeLog([
      ...lines.slice(0, 117),
      lines[118],
      ok,
      ...lines.slice(117, 118),
      ...lines.slice(119),
    ])
    expect(chat(report, '2026-10-19T15:03:06', '0.8s').taskIds).toEqual([887])
    expect(chat(report, '2026-10-19T15:03:06', '3m44s').taskIds).toEqual([])
  })

  // Synthetic: aborted-load.log with its 499 (line 179) made a 500, and a held cancel in front of it
  // -- cancel-before-500.log's line 117, for a task this slice never launches. Every real aborted
  // load ended in a 499; were one to end in a 500, it is still the aborted load, not that task.
  it('does not give a held cancel to a 500 that ends an aborted load', () => {
    const cancel = fixture('cancel-before-500.log')[116]
    const lines = fixture('aborted-load.log').map((l) => l.replace('| 499 |', '| 500 |'))
    const r = chat(analyzeLog([cancel, ...lines]), '2026-09-25T23:43:30', '10.7321013s')
    expect(r.kind).toBe('load-aborted')
    expect(r.taskIds).toEqual([])
  })

  // Synthetic: context-full.log with its request failing instead -- the 200 (line 211) made a 500
  // and moved, with a copy of the cancel line (174) re-numbered for task 25259, before 25259's
  // release (209). The server-side cancel of 24549 is still followed by 25259's launch, so it stays
  // a continuation and must not be taken as the failure's own cancel. 25259's timing summary
  // (205-208) stays before the 500, where a real cancellation would print it after or not at all;
  // nothing asserted here reads it.
  it('keeps a continuation whose request then fails with the request', () => {
    const lines = fixture('context-full.log')
    const failed = lines[210].replace('| 200 |', '| 500 |')
    const cancel = lines[173].replace('24549', '25259')
    const report = analyzeLog([...lines.slice(0, 208), failed, cancel, ...lines.slice(208, 210)])
    const r = chat(report, '2026-09-21T12:56:46', '1m28s')
    expect(r.kind).toBe('cancelled')
    expect(r.taskIds).toEqual([24549, 25259])
  })

  // Synthetic: queue-bound-trials-6-8.log with the other client's three requests (the 5m7s lines)
  // re-pathed to Ollama's OpenAI-compatible endpoint, and its eight GET /api/tags polls to the
  // compatible API's model listing. Neither real log has such a line, but a client on that API
  // holds the same slot and must count the same way -- while a listing runs no model.
  it('counts a client on the OpenAI-compatible API as model traffic', () => {
    const lines = fixture('queue-bound-trials-6-8.log').map((l) =>
      !l.startsWith('[GIN]')
        ? l
        : l.includes('5m7s')
          ? l.replace('"/api/chat"', '"/v1/chat/completions"')
          : l.replace('"/api/tags"', '"/v1/models"')
    )
    const report = analyzeLog(lines)
    expect(report.requests.some((r) => r.endpoint === '/v1/models')).toBe(false)
    expect(chat(report, '2026-09-18T18:46:52', '5m7s').taskIds).toEqual([9082])
    expect(chat(report, '2026-09-18T18:47:11', '5m0s').taskIds).toEqual([9760])
    const w = checkWindow(report, wallMs('2026-09-18T18:42:10'), wallMs('2026-09-18T18:48:00'))
    expect(w.contention).toBe(true)
  })

  // Synthetic: a single request line in Ollama's format -- neither real log contains an embedding
  // request. Embeddings own no chat task, so they must not trip the unreadable-log guard.
  it('does not treat a window of embedding requests as an unreadable log', () => {
    const embed =
      '[GIN] 2026/09/26 - 12:00:00 | 200 |     45.1234ms |       127.0.0.1 | POST     "/api/embed"'
    const w = checkWindow(
      analyzeLog([embed]),
      wallMs('2026-09-26T12:00:00'),
      wallMs('2026-09-26T12:00:01')
    )
    expect(w.requests).toHaveLength(1)
  })
})

describe('several log files at once (Ollama rotates server.log on every restart)', () => {
  it("keeps each file's tasks apart when merging", () => {
    const once = fixture('devstral-load-and-request.log')
    const merged = analyzeLogs([once, once])
    const served = merged.requests.filter((r) => r.endpoint === '/api/chat')
    expect(served).toHaveLength(2)
    expect(new Set(served.map((r) => r.taskKeys[0])).size).toBe(2)
    for (const r of served) expect(merged.tasks.get(r.taskKeys[0])?.evalTokens).toBe(304)
    expect(merged.utcOffsets).toEqual(['-05:00'])
  })

  // The two slices cover 18:42:10-18:57:15 and 20:02:55-20:07:57. Between them lie trial 11's
  // contended requests (mixed-trial-11.log, 19:04-19:10), which neither file holds.
  it('refuses a window that falls between the files read', () => {
    const merged = analyzeLogs([
      fixture('queue-bound-trials-6-8.log'),
      fixture('generation-bound-ornith.log'),
    ])
    expect(() =>
      checkWindow(merged, wallMs('2026-09-18T19:06:19'), wallMs('2026-09-18T19:10:21'))
    ).toThrow(/not covered/)
  })

  // Synthetic second file: devstral-load-and-request.log without its request lines. The first
  // file's request lines say nothing about whether the second file's format was understood.
  it("judges each file's format by its own request lines", () => {
    const noRequests = fixture('devstral-load-and-request.log').filter(
      (l) => !l.startsWith('[GIN]')
    )
    const merged = analyzeLogs([fixture('queue-bound-trials-6-8.log'), noRequests])
    expect(() =>
      checkWindow(merged, wallMs('2026-09-25T22:36:05'), wallMs('2026-09-25T22:36:28'))
    ).toThrow(/no request lines/)
  })

  // The ornith slice (20:02-20:08) is read first; only the second file covers the trials window.
  it('vouches for a window covered by any of the files read', () => {
    const merged = analyzeLogs([
      fixture('generation-bound-ornith.log'),
      fixture('queue-bound-trials-6-8.log'),
    ])
    const w = checkWindow(merged, wallMs('2026-09-18T18:42:10'), wallMs('2026-09-18T18:48:00'))
    expect(w.contention).toBe(true)
  })
})

describe('Ollama version the parser was validated against', () => {
  // The real server-start line from the live 0.34.4 log.
  const listening =
    'time=2026-09-25T21:07:02.669-05:00 level=INFO source=routes.go:2065 msg="Listening on 127.0.0.1:11434 (version 0.34.4)"'
  const window = [wallMs('2026-09-25T22:36:03'), wallMs('2026-09-25T22:37:46')] as const
  const versionWarnings = (lines: string[]) =>
    checkWindow(analyzeLog(lines), ...window).warnings.filter((x) => /Ollama version/.test(x))

  it('is silent for a validated version', () => {
    expect(versionWarnings([listening, ...fixture('devstral-load-and-request.log')])).toEqual([])
  })

  // Synthetic: the same line claiming a version this parser has never been checked against.
  it('warns for a version it was not validated against', () => {
    const newer = listening.replace('0.34.4', '0.35.0')
    expect(versionWarnings([newer, ...fixture('devstral-load-and-request.log')])[0]).toMatch(
      /0\.35\.0/
    )
  })
})

describe('command line', () => {
  const log = 'tests/fixtures/ollama-log/queue-bound-trials-6-8.log'
  const quiet = () => vi.spyOn(console, 'log').mockImplementation(() => {})

  it('exits 3 when the window has contention and 0 when it does not', () => {
    const spy = quiet()
    expect(
      main(['--log', log, '--from', '2026-09-18T18:42:10', '--to', '2026-09-18T18:48:00'])
    ).toBe(3)
    const ornith = 'tests/fixtures/ollama-log/generation-bound-ornith.log'
    expect(
      main(['--log', ornith, '--from', '2026-09-18T20:02:55', '--to', '2026-09-18T20:07:57'])
    ).toBe(0)
    spy.mockRestore()
  })

  // The window holds one request, cancelled mid-load of a model other than dec52a44569a. Only the
  // flag makes that load count as contention, so a flag that never reached the check would exit 0.
  it('exits 3 for a model the run did not ask for only when --expected-blob is given', () => {
    const aborted = 'tests/fixtures/ollama-log/aborted-load.log'
    const window = ['--from', '2026-09-25T23:43:20', '--to', '2026-09-25T23:43:31']
    const spy = quiet()
    expect(main(['--log', aborted, ...window, '--expected-blob', 'dec52a44569a'])).toBe(3)
    expect(main(['--log', aborted, ...window])).toBe(0)
    spy.mockRestore()
  })

  it('refuses to run without a window, or with an argument it does not know', () => {
    expect(() => main(['--log', log])).toThrow(/--from and --to are required/)
    expect(() => main(['--frm', 'x'])).toThrow(/unknown argument: --frm/)
  })

  // A flag whose value is missing must not quietly switch its check off.
  it('refuses a flag given without a value', () => {
    const window = ['--from', '2026-09-18T18:42:10', '--to', '2026-09-18T18:48:00']
    const spy = quiet()
    expect(() => main(['--log', log, ...window, '--expected-blob'])).toThrow(
      /--expected-blob needs a value/
    )
    expect(() => main(['--log', log, ...window, '--expected-blob', ''])).toThrow(
      /--expected-blob needs a value/
    )
    expect(() => main(['--log', log, '--expected-blob', '--json', ...window])).toThrow(
      /--expected-blob needs a value/
    )
    spy.mockRestore()
  })

  it('refuses an expected blob that is not a sha256 prefix', () => {
    const report = analyzeLog(fixture('aborted-load.log'))
    const window = [wallMs('2026-09-25T23:43:20'), wallMs('2026-09-25T23:43:31')] as const
    expect(() => checkWindow(report, ...window, { expectedBlob: '' })).toThrow(/expectedBlob/)
  })

  // devstral-load-and-request.log records its offset (-05:00) on its time= lines.
  it("converts a UTC window into the log's own local time", () => {
    const report = analyzeLog(fixture('devstral-load-and-request.log'))
    expect(toWall('2026-09-26T03:37:46Z', report)).toBe(wallMs('2026-09-25T22:37:46'))
    expect(toWall('2026-09-25T22:37:46-05:00', report)).toBe(wallMs('2026-09-25T22:37:46'))
    expect(toWall('2026-09-25T22:37:46', report)).toBe(wallMs('2026-09-25T22:37:46'))
  })

  // Synthetic: one time= line re-stamped with a different offset, as across a DST change.
  it('refuses to guess a conversion when the log spans two offsets', () => {
    const lines = fixture('devstral-load-and-request.log')
    const shifted = lines.map((l, i) => (i === 5 ? l.replace('-05:00', '-06:00') : l))
    expect(() => toWall('2026-09-26T03:37:46Z', analyzeLog(shifted))).toThrow(/cannot convert/)
  })

  // Synthetic: devstral-load-and-request.log line 6 with a terminal escape sequence planted in the
  // free-memory field. Log text is untrusted; it must not reach the terminal as control bytes.
  it('prints no control characters taken from the log', () => {
    const lines = fixture('devstral-load-and-request.log').map((l, i) =>
      i === 5 ? l.replace('free="7.8 GiB"', 'free="7.8 GiB\u001b[2J"') : l
    )
    const report = analyzeLog(lines)
    const w = checkWindow(report, wallMs('2026-09-25T22:36:03'), wallMs('2026-09-25T22:37:46'))
    const text = renderText(report, w).join('\n')
    expect(text).toContain('free=7.8 GiB?[2J')
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/)
  })
})

describe('checkWindow refuses to report a clean window it could not read', () => {
  // Request lines alone, with every llama-server line stripped: the shape of a log whose format
  // changed under us. "No contention" here would be a harness bug reading as a result.
  it('throws instead of reporting no contention', () => {
    const requestLinesOnly = fixture('queue-bound-trials-6-8.log').filter((l) =>
      l.startsWith('[GIN]')
    )
    const report = analyzeLog(requestLinesOnly)
    expect(() =>
      checkWindow(report, wallMs('2026-09-18T18:42:10'), wallMs('2026-09-18T18:57:15'))
    ).toThrow(/log format not recognized/)
  })

  // Ollama rotates server.log on every restart, and this machine keeps five old copies. Read only
  // a later log, the Sep 18 trials' window holds no requests at all.
  it('refuses a window the logs read do not reach, e.g. one whose file has rotated away', () => {
    const report = analyzeLog(fixture('generation-bound-ornith.log'))
    const trials = [wallMs('2026-09-18T18:40:00'), wallMs('2026-09-18T19:35:00')] as const
    expect(() => checkWindow(report, ...trials)).toThrow(/not covered/)
    const ornith = 'tests/fixtures/ollama-log/generation-bound-ornith.log'
    expect(() =>
      main(['--log', ornith, '--from', '2026-09-18T18:40:00', '--to', '2026-09-18T19:35:00'])
    ).toThrow(/not covered/)
  })

  // queue-bound-trials-6-8.log runs from 18:42:10 (line 1) to 18:57:15 (its last timestamp); request
  // lines are floored to the second, so the log can vouch for up to 1 s past its last line.
  it('refuses a window reaching past either end of the log, and accepts its own span', () => {
    const report = analyzeLog(fixture('queue-bound-trials-6-8.log'))
    const at = (t: string) => wallMs(`2026-09-18T${t}`)
    expect(() => checkWindow(report, at('18:42:09'), at('18:50:00'))).toThrow(/not covered/)
    expect(() => checkWindow(report, at('18:50:00'), at('18:57:17'))).toThrow(/not covered/)
    expect(checkWindow(report, at('18:42:10'), at('18:57:16')).contention).toBe(true)
  })

  // input-truncation.log: nothing was in flight between 19:49:56 (line 1's request ended) and
  // 19:50:04.8 (line 92's request arrived). A quiet window inside the log is a real "no".
  it('still reports an idle window inside the log as no contention', () => {
    const report = analyzeLog(fixture('input-truncation.log'))
    const w = checkWindow(report, wallMs('2026-09-17T19:49:57'), wallMs('2026-09-17T19:50:04'))
    expect(w.requests).toEqual([])
    expect(w.contention).toBe(false)
  })

  // A mistyped bound ("3O" for "30") must not become NaN and match nothing.
  it('refuses a malformed or inverted window instead of reading it as an empty one', () => {
    const report = analyzeLog(fixture('devstral-load-and-request.log'))
    expect(() => toWall('2026-09-25T22:3O:00-05:00', report)).toThrow(/unrecognized time/)
    const end = wallMs('2026-09-25T22:37:46')
    expect(() => checkWindow(report, NaN, end)).toThrow(/invalid window/)
    expect(() => checkWindow(report, end, end - 60_000)).toThrow(/invalid window/)
  })

  // Synthetic: devstral-load-and-request.log with every request line removed -- the shape of a log
  // whose request-line format changed. Its time= lines still cover the window.
  it('refuses a log in which no request line could be read', () => {
    const lines = fixture('devstral-load-and-request.log').filter((l) => !l.startsWith('[GIN]'))
    const report = analyzeLog(lines)
    expect(() =>
      checkWindow(report, wallMs('2026-09-25T22:36:05'), wallMs('2026-09-25T22:36:28'))
    ).toThrow(/no request lines/)
  })

  // Synthetic: queue-bound-trials-6-8.log as it would have read at 18:57:14 had the other client's
  // request (task 10628) still been running when trial 8 timed out -- lines 1-490 and 502-503,
  // without that request's 500 (491), cancel (494) and release (496). A request line is written
  // only when its request ends, so a log read at that moment cannot know what the running one did.
  it('refuses a window while a request that started by its end is still running', () => {
    const lines = fixture('queue-bound-trials-6-8.log')
    const early = analyzeLog([...lines.slice(0, 490), ...lines.slice(501, 503)])
    const trial8 = [wallMs('2026-09-18T18:52:14'), wallMs('2026-09-18T18:57:14')] as const
    expect(() => checkWindow(early, ...trial8)).toThrow(/still running/)
    // Once that request had ended, the whole log answers: trial 8 waited behind it.
    expect(checkWindow(analyzeLog(lines), ...trial8).contention).toBe(true)
  })

  // fast-200-before-release.log read up to line 28, as a live read at that moment would see it: the
  // request's 200 (28) is there, its task's release (33) is not yet. A 200 that owns no task of its
  // own takes a running task by the same fallback (next test), and at second resolution the two
  // cannot be told apart -- so a started task counts as running until its release is logged.
  it("waits for a task's release even after its request has logged its end", () => {
    const lines = fixture('fast-200-before-release.log')
    const window = [wallMs('2026-09-21T15:17:38'), wallMs('2026-09-21T15:17:39')] as const
    expect(() => checkWindow(analyzeLog(lines.slice(0, 28)), ...window)).toThrow(/still running/)
    expect(checkWindow(analyzeLog(lines.slice(0, 33)), ...window).contention).toBe(false)
  })

  // Synthetic: queue-bound-trials-6-8.log lines 1-187 (task 9760 has started and is running) plus one
  // 200 that owns no task, such as a model preload's. The fast-request fallback hands it task 9760;
  // that must not hide the task from the in-flight check.
  it('is not fooled by a request without a task of its own', () => {
    const preload =
      '[GIN] 2026/09/18 - 18:46:53 | 200 |      1.0523ms |       127.0.0.1 | POST     "/api/chat"'
    const lines = [...fixture('queue-bound-trials-6-8.log').slice(0, 187), preload]
    const window = [wallMs('2026-09-18T18:42:11'), wallMs('2026-09-18T18:46:52')] as const
    expect(() => checkWindow(analyzeLog(lines), ...window)).toThrow(/still running/)
  })

  // runner-crash.log (2026-09-30): llama-server ran out of GPU memory during task 229's prompt
  // processing (lines 56-59); Ollama answered that request with a 500 (60), logged "llama-server
  // terminated" (61) and started a new server (294), whose task 0 served the next request
  // (312-365). Task 229 never gets a release line, but it cannot be running once its server is gone.
  it('stops counting a task as running once its llama-server has terminated', () => {
    const report = analyzeLog(fixture('runner-crash.log'))
    expect(report.coverage[0].unfinishedSince).toEqual([])
    const w = checkWindow(report, wallMs('2026-09-30T08:00:56'), wallMs('2026-09-30T08:02:26'))
    expect(w.contention).toBe(false)
    expect(chat(report, '2026-09-30T08:02:26', '1m30s').taskIds).toEqual([0])
  })

  // mixed-trial-11.log ends with task 14350 unreleased: its request's 500 is already at line 148,
  // only the cancel is missing. Its "new prompt" (112) follows the 19:09:24 line (85). A window
  // that ended before then is answered; one reaching it is not.
  it('answers a window that ended before an unfinished task started', () => {
    const report = analyzeLog(fixture('mixed-trial-11.log'))
    const from = wallMs('2026-09-18T19:06:19')
    expect(checkWindow(report, from, wallMs('2026-09-18T19:09:23')).contention).toBe(true)
    expect(() => checkWindow(report, from, wallMs('2026-09-18T19:09:24'))).toThrow(/still running/)
  })
})
