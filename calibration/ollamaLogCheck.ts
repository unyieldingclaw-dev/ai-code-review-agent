/**
 * Read-only check of Ollama's own server log: explains where a request's time went (waiting in
 * queue, loading a model, processing the prompt, generating) and whether anything else was using
 * the server during a calibration window.
 *
 * WHY this exists: a timed-out request returns no response body, so ACR cannot see why it timed
 * out -- and the one time that was checked (2026-09-18's recall study), 3 of devstral's 4
 * "timeouts" turned out to be spent waiting behind another client's requests, not generating.
 * Ollama 0.34.x logs that evidence itself, through the llama.cpp `llama-server` it runs.
 *
 *   npx tsx calibration/ollamaLogCheck.ts --from 2026-09-18T18:40:00 --to 2026-09-18T19:35:00
 *     [--log <file>]... [--expected-blob <sha256 prefix>] [--json]
 *
 * Times are the log's own local wall-clock time; an ISO time with Z or an offset is converted
 * using the offset the log records. Exit codes: 0 no contention, 3 contention, 1 error.
 *
 * What "no contention" covers: COMPLETED requests only. Ollama writes a request's line when the
 * request ends, and a request still waiting in its queue appears nowhere in the log until then --
 * so "no contention" holds only once every request overlapping the window, other clients'
 * included, has ended. A check made at the end of a run is therefore provisional: re-check from
 * the complete log once the server is idle. The window must lie within one log file's own span (a
 * window across a restart must be split). The check exits 1 rather than 0 when the logs read cannot
 * vouch for the window -- e.g. it lies outside every file read, or the file's format was not
 * understood -- and, as a best-effort tripwire, while a llama-server task that started by the
 * window's end has not released (unless its llama-server has terminated, e.g. crashed); a request
 * still queued inside Ollama escapes that tripwire.
 * "Contention" is any overlap between model requests, including the caller's own parallel ones.
 *
 * Precision: request lines are second-resolution and llama-server lines carry no timestamps, so a
 * task's start is known only as "not before the nearest earlier timestamped line". The wait before
 * a task started is therefore a MINIMUM and its compute time a MAXIMUM, each good to about 1 s --
 * "about", because llama-server's lines reach the log through a pipe and can lag Ollama's own
 * lines slightly (a sub-second request's 200 has been seen logged before its task's release). The
 * order also runs the other way: a timed-out request's cancel has been seen logged before its 500.
 * Requests that fail together are paired with their tasks by log order alone; they are flagged
 * (pairedByLogOrder), because their timings may belong to each other. A cancel logged with no
 * failed request waiting is held for the next 5xx chat/generate request, unless a new task
 * launches first; that pairing is not flagged, because in the real logs the 500 was always the
 * very next line.
 */
import { readFileSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'

export interface LoadRecord {
  at: number
  blob: string
  ctxArg: number
  parallel: number
  ok: boolean
  aborted: boolean
  abortedAt?: number
  loadSeconds?: number
  gpuLayers?: string
  nCtx?: number
  nCtxTrain?: number
  kvCpuMiB?: number
  kvGpuMiB?: number
  kvType?: string
  flashAttention?: 'enabled'
  speculative?: 'none'
  systemFree?: string
  gpuAvailable?: string
}

export interface Sampler {
  temp: number
  topK: number
  topP: number
  presencePenalty: number
}

export interface TaskRecord {
  key: string
  id: number
  // Launched ("processing task") or started ("new prompt") inside the log we read. A task with
  // neither began before the log slice, so nothing can be said about its wait or output.
  seenLaunch: boolean
  started: boolean
  startedNotBefore?: number
  promptTokens?: number
  cachedTokens?: number
  prefillMs?: number
  prefillProgressMs?: number
  prefillTokens?: number
  evalMs?: number
  evalTokens?: number
  stopNTokens?: number
  truncated?: boolean
  released: boolean
  linked: boolean
  serverCancelled: boolean
  // Its llama-server terminated before it released (e.g. a crash): it will never log a release,
  // and it cannot still be running.
  killed: boolean
  promptCacheMs?: number
  sampler?: Sampler
  inputTruncated?: { limit: number; originalTokens: number }
}

export type Bucket = 'queue' | 'load' | 'prefill' | 'generation'

export interface RequestRecord {
  endpoint: string
  status: number
  end: number
  durationText: string
  durationMs: number
  arrival: number
  // 'queued-abandoned': the client gave up while the request was still queued inside Ollama, so
  // no llama-server task ever existed for it.
  kind: 'completed' | 'cancelled' | 'queued-abandoned' | 'load-aborted' | 'unlinked'
  taskIds: number[]
  taskKeys: string[]
  // Failed while another failed request was still waiting for its cancel line, so which task was
  // whose rests on the order of the lines alone.
  pairedByLogOrder: boolean
  started: boolean
  // Prompt tokens served from llama-server's cache: 0 is a cold prefill of the whole prompt.
  cachedPromptTokens?: number
  minWaitBeforeStartMs?: number
  maxComputeMs?: number
  loadMsDuringWait: number
  promptCacheMs?: number
  prefillMs?: number
  prefillTokens?: number
  evalMs?: number
  generatedTokens?: number
  contextFull: boolean
  inputTruncated?: { limit: number; originalTokens: number }
  dominant?: Bucket
}

export interface LogReport {
  loads: LoadRecord[]
  requests: RequestRecord[]
  tasks: Map<string, TaskRecord>
  inputTruncations: Array<{ at: number; limit: number; originalTokens: number }>
  utcOffsets: string[]
  ollamaVersions: string[]
  // One entry per file read that has any timestamp. Files are never joined: the time between two
  // of them may belong to a file that was not read.
  coverage: LogCoverage[]
}

export interface LogCoverage {
  // Earliest and latest timestamps in the file: the only stretch of time it can vouch for.
  first: number
  last: number
  // Every request line in the file, model endpoint or not.
  requestLines: number
  // Start times (-Infinity if unknown) of tasks launched but not released by the end of the file,
  // other than those whose llama-server terminated: still running, or lost without a line saying
  // so. Their requests may or may not have logged their end already.
  unfinishedSince: number[]
}

export interface WindowCheck {
  requests: RequestRecord[]
  overlaps: Array<[RequestRecord, RequestRecord]>
  modelsLoaded: string[]
  foreignModels: string[]
  contention: boolean
  warnings: string[]
}

// Endpoints that run a model. /api/tags, /api/show and /api/ps do not, so they neither contend
// for the slot nor own a llama-server task. Every POST under /v1/ (Ollama's OpenAI-compatible API)
// runs one too; matching the prefix rather than listing its paths keeps a compatible endpoint this
// list never named from passing unseen.
const MODEL_ENDPOINTS = new Set(['/api/chat', '/api/generate', '/api/embed', '/api/embeddings'])
const LINKING_ENDPOINTS = new Set(['/api/chat', '/api/generate'])
const COMPATIBLE_API = '/v1/'

function isModelRequest(method: string, path: string): boolean {
  return MODEL_ENDPOINTS.has(path) || (method === 'POST' && path.startsWith(COMPATIBLE_API))
}

// Whether a recorded model request owns a chat task (embeddings never do). Only POSTs under /v1/
// are recorded, so the path alone decides.
function ownsChatTask(path: string): boolean {
  return LINKING_ENDPOINTS.has(path) || (path.startsWith(COMPATIBLE_API) && !path.includes('embed'))
}

// A long regex capture can be a view into its line, itself a view into the whole file's text;
// keeping it in a record would keep all of that text in memory.
const own = (capture: string): string => Buffer.from(capture).toString()

// Request end times are floored to the second and durations over a minute are truncated to the
// second, so two back-to-back requests can appear to overlap by up to ~2 s.
const OVERLAP_TOLERANCE_MS = 2000

// Slack on either side of a request's interval when matching an event to it, for the same reason:
// the request line's time is floored to the second.
const SECOND_RESOLUTION_SLACK_MS = 1000

// A failed request's cancel line, and a queue abort's request line, follow within moments. One
// still unmatched after this long belongs to a request whose task never existed.
const STALE_CANCEL_MS = 5000

// Versions whose logs this parser was checked against line by line. Another version may log
// differently; its output is then unverified, not wrong.
const VALIDATED_OLLAMA_VERSIONS = ['0.34.0', '0.34.4']

/** Log-local wall-clock time as epoch-style milliseconds (no timezone applied, on purpose). */
export function wallMs(text: string): number {
  const m = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?$/)
  if (!m) throw new Error(`unrecognized wall-clock time: ${JSON.stringify(text)}`)
  const ms = m[7] ? Math.round(Number(m[7]) * 1000) : 0
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms)
}

/** Go's time.Duration text ("5m0s", "10.7321013s", "47.235ms", "999µs") in milliseconds. */
export function parseDurationMs(text: string): number {
  const units: Record<string, number> = {
    h: 3_600_000,
    m: 60_000,
    s: 1000,
    ms: 1,
    µs: 0.001,
    us: 0.001,
    ns: 0.000001,
  }
  const parts = [...text.matchAll(/(\d+(?:\.\d+)?)(ms|µs|us|ns|h|m|s)/g)]
  // Every character must belong to a number+unit pair; anything left over means a format this
  // parser does not know, and reading that as 0 would make a request look instant.
  if (parts.length === 0 || parts.map((p) => p[0]).join('') !== text) {
    throw new Error(`unrecognized duration: ${JSON.stringify(text)}`)
  }
  return parts.reduce((sum, p) => sum + Number(p[1]) * units[p[2]], 0)
}

export function analyzeLog(lines: string[], keyPrefix = ''): LogReport {
  const loads: LoadRecord[] = []
  const requests: RequestRecord[] = []
  const tasks = new Map<string, TaskRecord>()
  // Tasks not yet linked to a request, in log order -- so linking does not rescan every task the
  // log has ever seen.
  const unlinked = new Map<string, TaskRecord>()
  const inputTruncations: LogReport['inputTruncations'] = []
  const utcOffsets: string[] = []
  const ollamaVersions: string[] = []

  let stamp: number | undefined
  // llama-server numbers tasks from 0 again after every model load, so a task id is only
  // meaningful within the server process that issued it.
  let scope = 0
  let load: LoadRecord | undefined
  // Failed requests waiting for their task's "cancel task" line. Not simply "the last one": the
  // next client's own request line can be logged in between (seen: 500, /api/tags 200, cancel).
  const awaitingCancel: RequestRecord[] = []
  // Requests that waited for a cancel alongside another one.
  const contested = new Set<RequestRecord>()
  // A task cancelled while no failed request was waiting. Either the server stopped it to resubmit
  // as a continuation -- then the next task launches -- or its own request's failure line simply
  // follows the cancel (seen on 0.34.4-0.40.4) -- then its 5xx request line comes first.
  let orphanCancel: TaskRecord | undefined
  // Times of queue-abort lines not yet matched to their request's line.
  const queueAborts: number[] = []
  let pendingCacheMs: number | undefined
  let pendingPresence: number | undefined
  let pendingSampler: Sampler | undefined
  let pendingTruncation: TaskRecord['inputTruncated'] | undefined
  let span: { first: number; last: number } | undefined
  let requestLines = 0

  const setStamp = (at: number): void => {
    stamp = at
    span = { first: Math.min(span?.first ?? at, at), last: Math.max(span?.last ?? at, at) }
    while (awaitingCancel.length > 0 && at - awaitingCancel[0].end > STALE_CANCEL_MS) {
      awaitingCancel.shift()
    }
    while (queueAborts.length > 0 && at - queueAborts[0] > STALE_CANCEL_MS) queueAborts.shift()
  }

  const task = (id: number): TaskRecord => {
    const key = `${keyPrefix}${scope}:${id}`
    let t = tasks.get(key)
    if (!t) {
      t = {
        key,
        id,
        seenLaunch: false,
        started: false,
        released: false,
        linked: false,
        serverCancelled: false,
        killed: false,
      }
      tasks.set(key, t)
      unlinked.set(key, t)
    }
    return t
  }

  // A request owns its own task(s) plus any earlier tasks the server itself cancelled and
  // resubmitted on its behalf (a continuation near the context limit), which have no request line.
  const link = (req: RequestRecord, owned: TaskRecord[]): void => {
    const continuations = [...unlinked.values()].filter(
      (t) => t.released && t.serverCancelled && !owned.includes(t)
    )
    for (const t of [...continuations, ...owned]) {
      t.linked = true
      unlinked.delete(t.key)
      req.taskKeys.push(t.key)
      req.taskIds.push(t.id)
    }
  }

  const onTaskLine = (line: string): void => {
    let m: RegExpMatchArray | null
    if ((m = line.match(/task (\d+) \| processing task/))) {
      const t = task(Number(m[1]))
      t.seenLaunch = true
      orphanCancel = undefined
      t.promptCacheMs = pendingCacheMs
      t.sampler = pendingSampler
      pendingCacheMs = undefined
      pendingSampler = undefined
      pendingPresence = undefined
    } else if ((m = line.match(/task (\d+) \| new prompt, .*task\.n_tokens = (\d+)/))) {
      const t = task(Number(m[1]))
      t.started = true
      t.startedNotBefore = stamp
      t.promptTokens = Number(m[2])
      t.inputTruncated = pendingTruncation
      pendingTruncation = undefined
    } else if ((m = line.match(/task (\d+) \| cached n_tokens = (\d+)/))) {
      const t = task(Number(m[1]))
      if (t.started && t.cachedTokens === undefined) t.cachedTokens = Number(m[2])
    } else if ((m = line.match(/task (\d+) \| prompt processing, .*\bt =\s+([\d.]+) s/))) {
      task(Number(m[1])).prefillProgressMs = Number(m[2]) * 1000
    } else if (
      (m = line.match(/task (\d+) \| prompt eval time =\s+([\d.]+) ms \/\s+(\d+) tokens/))
    ) {
      const t = task(Number(m[1]))
      t.prefillMs = Number(m[2])
      t.prefillTokens = Number(m[3])
    } else if ((m = line.match(/task (\d+) \|\s+eval time =\s+([\d.]+) ms \/\s+(\d+) tokens/))) {
      const t = task(Number(m[1]))
      t.evalMs = Number(m[2])
      t.evalTokens = Number(m[3])
    } else if (
      (m = line.match(/task (\d+) \| stop processing: n_tokens = (\d+), truncated = (\d)/))
    ) {
      const t = task(Number(m[1]))
      t.stopNTokens = Number(m[2])
      t.truncated = m[3] === '1'
      t.released = true
    }
  }

  for (const line of lines) {
    let m: RegExpMatchArray | null

    if (
      (m = line.match(/^time=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})/))
    ) {
      setStamp(wallMs(m[1]))
      if (!utcOffsets.includes(m[2])) utcOffsets.push(m[2])
    } else if (
      (m = line.match(
        /^\[GIN\] (\d{4}\/\d{2}\/\d{2}) - (\d{2}:\d{2}:\d{2}) \| +(\d{3}) \| +(\S+) \| +\S+ \| +(\w+) +"([^"]+)"/
      ))
    ) {
      const end = wallMs(`${m[1]} ${m[2]}`)
      setStamp(end)
      requestLines++
      if (!isModelRequest(m[5], m[6])) continue
      const endpoint = own(m[6])
      const durationMs = parseDurationMs(m[4])
      const req: RequestRecord = {
        endpoint,
        status: Number(m[3]),
        end,
        durationText: m[4],
        durationMs,
        arrival: end - durationMs,
        kind: 'unlinked',
        taskIds: [],
        taskKeys: [],
        pairedByLogOrder: false,
        started: false,
        loadMsDuringWait: 0,
        contextFull: false,
      }
      requests.push(req)
      if (!ownsChatTask(endpoint)) continue
      if (req.status === 200) {
        // Tasks known to have run inside this log (a task first seen at its release began
        // before the slice and belongs to an earlier request).
        const candidates = [...unlinked.values()].filter(
          (t) => !t.serverCancelled && (t.seenLaunch || t.started)
        )
        const released = candidates.filter((t) => t.released)
        // A sub-second request's 200 can be logged before its task's release lines, because
        // llama-server's output reaches the log through a pipe. Then the task is still in flight.
        link(req, released.length > 0 ? released : candidates.filter((t) => t.started).slice(-1))
        continue
      }
      const abort = queueAborts.findIndex(
        (at) =>
          at >= req.arrival - SECOND_RESOLUTION_SLACK_MS &&
          at <= req.end + SECOND_RESOLUTION_SLACK_MS
      )
      if (abort >= 0) {
        req.kind = 'queued-abandoned'
        queueAborts.splice(abort, 1)
      } else if (
        orphanCancel &&
        !orphanCancel.linked &&
        req.status >= 500 &&
        !abortedLoadDuring(loads, req)
      ) {
        // Only a server error: in the real logs every request whose cancel came first was a 500,
        // while the 499s were aborted loads and the 404s had no task. Anything else falls through to
        // the handling used before this case was known.
        link(req, [orphanCancel])
        orphanCancel = undefined
      } else if (!abortedLoadDuring(loads, req)) {
        if (awaitingCancel.length > 0) {
          contested.add(req)
          for (const r of awaitingCancel) contested.add(r)
        }
        awaitingCancel.push(req)
      }
      continue
    }

    if ((m = line.match(/stop: cancel task, id_task = (\d+)/))) {
      const t = task(Number(m[1]))
      const req = awaitingCancel.shift()
      if (req) {
        req.pairedByLogOrder = contested.has(req)
        link(req, [t])
      } else {
        t.serverCancelled = true
        orphanCancel = t
      }
    } else if (/msg="llama-server terminated"/.test(line)) {
      const current = `${keyPrefix}${scope}:`
      for (const t of tasks.values()) {
        if (!t.released && t.key.startsWith(current)) t.killed = true
      }
    } else if ((m = line.match(/msg="Listening on .*\(version ([^)"]+)\)"/))) {
      if (!ollamaVersions.includes(m[1])) ollamaVersions.push(m[1])
    } else if (
      (m = line.match(
        /msg="starting llama-server" cmd=".*?sha256-([0-9a-f]{64}).*? -c (\d+) -np (\d+)/
      ))
    ) {
      load = {
        at: stamp ?? NaN,
        blob: own(m[1]),
        ctxArg: Number(m[2]),
        parallel: Number(m[3]),
        ok: false,
        aborted: false,
      }
      loads.push(load)
    } else if ((m = line.match(/llama-server started in ([\d.]+) seconds/)) && load) {
      // Ollama 0.34.4 prints this twice per load (again after "waiting for llama-server to start
      // responding", ~5 ms later). Only the first marks a new server process -- advancing the
      // task scope on both would be harmless today but wrong in principle.
      if (!load.ok) {
        load.ok = true
        load.loadSeconds = Number(m[1])
        scope++
      }
    } else if (/aborting load/.test(line) && load) {
      load.aborted = true
      load.abortedAt = stamp
    } else if (load && applyLoadLine(line, load)) {
      // recorded on the load
    } else if (
      /msg="aborting completion request due to client closing the connection"/.test(line)
    ) {
      if (stamp !== undefined) queueAborts.push(stamp)
    } else if ((m = line.match(/msg="truncating input prompt" limit=(\d+) prompt=(\d+)/))) {
      const cut = { at: stamp ?? NaN, limit: Number(m[1]), originalTokens: Number(m[2]) }
      inputTruncations.push(cut)
      pendingTruncation = { limit: cut.limit, originalTokens: cut.originalTokens }
    } else if ((m = line.match(/prompt cache update took ([\d.]+) ms/))) {
      pendingCacheMs = Number(m[1])
    } else if ((m = line.match(/^\s*repeat_last_n = .*presence_penalty = ([\d.]+)/))) {
      pendingPresence = Number(m[1])
    } else if ((m = line.match(/^\s*top_k = (\d+), top_p = ([\d.]+),.*\btemp = ([\d.]+)/))) {
      pendingSampler = {
        temp: Number(m[3]),
        topK: Number(m[1]),
        topP: Number(m[2]),
        presencePenalty: pendingPresence ?? 0,
      }
    } else if (line.includes(' | task ')) {
      onTaskLine(line)
    }
  }

  for (const req of requests) derive(req, tasks, loads)
  const unfinishedSince = [...tasks.values()]
    // Linked or not: a request that owns no task (a model preload, say) can be linked to a running
    // task by the fast-request fallback, and must not hide it.
    .filter((t) => (t.seenLaunch || t.started) && !t.released && !t.killed)
    .map((t) => t.startedNotBefore ?? -Infinity)
  return {
    loads,
    requests,
    tasks,
    inputTruncations,
    utcOffsets,
    ollamaVersions,
    coverage: span ? [{ ...span, requestLines, unfinishedSince }] : [],
  }
}

/** Records one line of a model load's execution envelope; false if the line is not one. */
function applyLoadLine(line: string, load: LoadRecord): boolean {
  let m: RegExpMatchArray | null
  if ((m = line.match(/msg="system memory" total="[^"]*" free="([^"]+)"/))) {
    load.systemFree = m[1]
  } else if ((m = line.match(/msg="gpu memory" .*?available="([^"]+)"/))) {
    load.gpuAvailable = m[1]
  } else if ((m = line.match(/offloaded (\d+)\/(\d+) layers to GPU/))) {
    load.gpuLayers = `${m[1]}/${m[2]}`
  } else if ((m = line.match(/llama_context: n_ctx\s+= (\d+)/))) {
    load.nCtx = Number(m[1])
  } else if ((m = line.match(/n_ctx_train\s+= (\d+)/))) {
    load.nCtxTrain = Number(m[1])
  } else if ((m = line.match(/llama_kv_cache:\s+CPU KV buffer size =\s+([\d.]+) MiB/))) {
    load.kvCpuMiB = Number(m[1])
  } else if ((m = line.match(/llama_kv_cache:\s+CUDA\d+ KV buffer size =\s+([\d.]+) MiB/))) {
    load.kvGpuMiB = (load.kvGpuMiB ?? 0) + Number(m[1])
  } else if ((m = line.match(/llama_kv_cache: size = .*K \((\w+)\)/))) {
    load.kvType = m[1]
  } else if (/Flash Attention enabled/.test(line)) {
    load.flashAttention = 'enabled'
  } else if (/no implementations specified for speculative decoding/.test(line)) {
    load.speculative = 'none'
  } else {
    return false
  }
  return true
}

function abortedLoadDuring(loads: LoadRecord[], req: RequestRecord): LoadRecord | undefined {
  return loads.find(
    (l) =>
      l.aborted &&
      l.abortedAt !== undefined &&
      l.at >= req.arrival - SECOND_RESOLUTION_SLACK_MS &&
      l.abortedAt <= req.end + SECOND_RESOLUTION_SLACK_MS
  )
}

function generatedBy(t: TaskRecord): number {
  if (t.evalTokens !== undefined) return t.evalTokens
  // n_tokens at stop = prompt + generated only for a task that actually started. A task that
  // never started still reports the slot's leftover state from the previous task.
  if (t.started && t.stopNTokens !== undefined && t.promptTokens !== undefined) {
    return Math.max(0, t.stopNTokens - t.promptTokens)
  }
  return 0
}

function derive(req: RequestRecord, tasks: Map<string, TaskRecord>, loads: LoadRecord[]): void {
  const ts = req.taskKeys.map((k) => tasks.get(k)!)
  const sum = (pick: (t: TaskRecord) => number | undefined): number | undefined => {
    const vals = ts.map(pick).filter((v): v is number => v !== undefined)
    return vals.length ? vals.reduce((a, b) => a + b, 0) : undefined
  }

  if (req.kind === 'queued-abandoned') {
    req.generatedTokens = 0
    req.minWaitBeforeStartMs = req.durationMs
    req.maxComputeMs = 0
    req.dominant = 'queue'
    return
  }

  if (ts.length === 0) {
    const aborted = abortedLoadDuring(loads, req)
    if (req.status !== 200 && aborted) {
      req.kind = 'load-aborted'
      req.loadMsDuringWait = aborted.abortedAt! - aborted.at
      req.dominant = 'load'
    }
    return
  }

  req.kind = req.status === 200 ? 'completed' : 'cancelled'
  req.contextFull = ts.some((t) => t.truncated === true)
  req.inputTruncated = ts[0].inputTruncated
  req.promptCacheMs = sum((t) => t.promptCacheMs)
  req.prefillTokens = sum((t) => t.prefillTokens)
  req.evalMs = sum((t) => t.evalMs)

  // Nothing is known about a task that began before the log slice: leave the timing undefined
  // rather than reading it as "never started".
  if (!ts.every((t) => t.seenLaunch || t.started)) return

  const first = ts.find((t) => t.started)
  req.started = first !== undefined
  req.cachedPromptTokens = first?.cachedTokens
  req.generatedTokens = ts.reduce((n, t) => n + generatedBy(t), 0)
  const startAt = first?.startedNotBefore
  req.minWaitBeforeStartMs =
    startAt === undefined ? req.durationMs : Math.max(0, startAt - req.arrival)
  req.maxComputeMs = startAt === undefined ? 0 : Math.max(0, req.end - startAt)
  req.loadMsDuringWait = loads
    .filter(
      (l) =>
        l.at >= req.arrival - SECOND_RESOLUTION_SLACK_MS &&
        l.at <= (startAt ?? req.end) + SECOND_RESOLUTION_SLACK_MS
    )
    .reduce(
      (n, l) =>
        n +
        (l.ok && l.loadSeconds !== undefined
          ? Math.round(l.loadSeconds * 1000)
          : l.aborted && l.abortedAt !== undefined
            ? l.abortedAt - l.at
            : 0),
      0
    )
  const prefill = sum((t) => t.prefillMs ?? t.prefillProgressMs)
  req.prefillMs = prefill

  const complete =
    req.status === 200 && ts.filter((t) => t.started).every((t) => t.evalMs !== undefined)
  const buckets: Record<Bucket, number> = {
    queue: Math.max(0, req.minWaitBeforeStartMs - req.loadMsDuringWait),
    load: req.loadMsDuringWait,
    prefill: Math.min(prefill ?? 0, req.maxComputeMs),
    generation: complete
      ? (req.evalMs ?? 0)
      : Math.max(0, req.maxComputeMs - Math.min(prefill ?? 0, req.maxComputeMs)),
  }
  req.dominant = (Object.keys(buckets) as Bucket[]).reduce((a, b) =>
    buckets[b] > buckets[a] ? b : a
  )
}

/**
 * Merges several log files (rotations of one server log); each file is parsed on its own, and one
 * file's lines at a time are held when `files` yields them lazily -- one rotated log here was
 * 16.5 MB.
 */
export function analyzeLogs(files: Iterable<string[]>): LogReport {
  const parts: LogReport[] = []
  for (const lines of files) parts.push(analyzeLog(lines, `f${parts.length}/`))
  return {
    loads: parts.flatMap((p) => p.loads),
    requests: parts.flatMap((p) => p.requests),
    tasks: new Map(parts.flatMap((p) => [...p.tasks])),
    inputTruncations: parts.flatMap((p) => p.inputTruncations),
    utcOffsets: [...new Set(parts.flatMap((p) => p.utcOffsets))],
    ollamaVersions: [...new Set(parts.flatMap((p) => p.ollamaVersions))],
    coverage: parts.flatMap((p) => p.coverage),
  }
}

export function checkWindow(
  report: LogReport,
  from: number,
  to: number,
  opts: { expectedBlob?: string } = {}
): WindowCheck {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    throw new Error(`invalid window: from (${from}) must be a time no later than to (${to})`)
  }
  if (opts.expectedBlob !== undefined && !/^[0-9a-f]+$/.test(opts.expectedBlob)) {
    throw new Error(
      `expectedBlob must be a sha256 hex prefix, not ${JSON.stringify(opts.expectedBlob)}`
    )
  }
  // A window holding no requests reads as "no contention" whether the server was idle or the log
  // never reached it -- e.g. its file is no longer among the rotated logs read. Only a window
  // inside one file's own span can be vouched for; request lines are floored to the second, so a
  // file vouches for up to that much past its last line.
  if (report.coverage.length === 0) {
    throw new Error(
      'no timestamped lines in the logs read: no log found, or a format this parser does not know'
    )
  }
  const file = report.coverage.find(
    (c) => from >= c.first && to <= c.last + SECOND_RESOLUTION_SLACK_MS
  )
  if (!file) {
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19)
    const spans = report.coverage.map((c) => `${iso(c.first)} to ${iso(c.last)}`).join(', ')
    throw new Error(
      `window not covered by any one log read (they run ${spans}, log-local time): read the ` +
        `log that covers the window, or narrow the window to one log's span`
    )
  }
  if (file.requestLines === 0) {
    throw new Error(
      'no request lines in the log covering the window: an idle server, or a request-line ' +
        'format this parser does not know'
    )
  }
  // A best-effort tripwire: a task that started by the window's end and has not released may belong
  // to a request whose line is not written yet. A request still queued inside Ollama has no line
  // and no task, so nothing here can see it -- see the header.
  if (file.unfinishedSince.some((since) => since <= to)) {
    throw new Error(
      'a llama-server task that started by the end of the window had not released when the log ' +
        'was read (still running, or killed without a release line): re-run once it has finished'
    )
  }

  const inWindow = report.requests
    .filter((r) => r.arrival < to && r.end >= from)
    .sort((a, b) => a.arrival - b.arrival)
  // Only chat and generate requests own a llama-server task, so only they can show whether the log
  // was read. An embedding request never links to one.
  const linkable = inWindow.filter((r) => ownsChatTask(r.endpoint))
  const explained = linkable.filter(
    (r) => r.taskIds.length > 0 || r.kind === 'load-aborted' || r.kind === 'queued-abandoned'
  )
  if (linkable.length > 0 && explained.length === 0) {
    throw new Error(
      `log format not recognized: ${linkable.length} chat/generate request(s) in the window, ` +
        `none linked to a llama-server task, a model load or a queue abort`
    )
  }

  const overlaps: WindowCheck['overlaps'] = []
  for (let i = 0; i < inWindow.length; i++) {
    for (let j = i + 1; j < inWindow.length; j++) {
      const [a, b] = [inWindow[i], inWindow[j]]
      // Sorted by arrival: once one arrives within the tolerance of a's end, every later one
      // does too, and none of them can share more than the tolerance with a.
      if (b.arrival >= a.end - OVERLAP_TOLERANCE_MS) break
      const shared = Math.min(a.end, b.end) - b.arrival
      if (shared > OVERLAP_TOLERANCE_MS) overlaps.push([a, b])
    }
  }

  const modelsLoaded = [
    ...new Set(report.loads.filter((l) => l.at >= from && l.at <= to).map((l) => l.blob)),
  ]
  const foreignModels = opts.expectedBlob
    ? modelsLoaded.filter((b) => !b.startsWith(opts.expectedBlob!))
    : []

  const warnings: string[] = []
  if (modelsLoaded.length > 1) {
    warnings.push(
      `${modelsLoaded.length} different models loaded in the window; task linking assumes one server at a time`
    )
  }
  if (report.utcOffsets.length > 1) {
    warnings.push(`log spans UTC offsets ${report.utcOffsets.join(', ')} (DST change?)`)
  }
  const unexplained = linkable.length - explained.length
  if (unexplained > 0) {
    warnings.push(
      `${unexplained} request(s) could not be linked to a task (began before the log slice?)`
    )
  }
  const byOrder = inWindow.filter((r) => r.pairedByLogOrder).length
  if (byOrder > 0) {
    warnings.push(
      `${byOrder} request(s) paired with their task by log order alone: they failed together and ` +
        `the log cannot tell whose task was whose, so their timings may be swapped`
    )
  }
  const validated = VALIDATED_OLLAMA_VERSIONS.join(', ')
  if (report.ollamaVersions.length === 0) {
    warnings.push(
      `no Ollama version line in the log read; this parser was validated on ${validated}`
    )
  }
  for (const v of report.ollamaVersions.filter((v) => !VALIDATED_OLLAMA_VERSIONS.includes(v))) {
    warnings.push(
      `Ollama version ${v} is not one this parser was validated on (${validated}); ` +
        `check its output against the log by hand`
    )
  }

  return {
    requests: inWindow,
    overlaps,
    modelsLoaded,
    foreignModels,
    contention: overlaps.length > 0 || foreignModels.length > 0,
    warnings,
  }
}

/** A --from/--to argument as log-local wall-clock time (see wallMs). */
export function toWall(text: string, report: LogReport): number {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(text)) return wallMs(text)
  if (report.utcOffsets.length !== 1) {
    throw new Error(
      `cannot convert ${text} to log-local time: the log records offsets [${report.utcOffsets.join(', ')}]; ` +
        `pass a local time without an offset instead`
    )
  }
  const [sign, hh, mm] =
    report.utcOffsets[0] === 'Z'
      ? ['+', '00', '00']
      : [report.utcOffsets[0][0], ...report.utcOffsets[0].slice(1).split(':')]
  const offsetMs = (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm)) * 60_000
  const utc = Date.parse(text)
  if (Number.isNaN(utc)) throw new Error(`unrecognized time: ${JSON.stringify(text)}`)
  return utc + offsetMs
}

function fmt(ms: number | undefined): string {
  return ms === undefined ? '?' : `${Math.round(ms / 1000)}s`
}

// Log text is untrusted: a control character copied from it could drive the terminal.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

/** The human-readable report, one string per line, with control characters replaced by "?". */
export function renderText(report: LogReport, check: WindowCheck): string[] {
  const out: string[] = []
  for (const l of report.loads.filter((l) => check.modelsLoaded.includes(l.blob))) {
    out.push(
      `load ${new Date(l.at).toISOString().slice(0, 19)} ${l.blob.slice(0, 12)} ` +
        `${l.ok ? `ok ${l.loadSeconds}s` : l.aborted ? 'ABORTED' : 'failed'} gpu=${l.gpuLayers ?? '?'} ` +
        `ctx=${l.nCtx ?? l.ctxArg} kv=${l.kvType ?? '?'} cpu/gpu=${l.kvCpuMiB ?? '?'}/${l.kvGpuMiB ?? '?'}MiB ` +
        `fa=${l.flashAttention ?? '?'} spec=${l.speculative ?? '?'} free=${l.systemFree ?? '?'}`
    )
  }
  for (const r of check.requests) {
    out.push(
      `${new Date(r.end).toISOString().slice(0, 19)} ${r.endpoint} ${r.status} ${r.durationText.padStart(12)} ` +
        `${r.kind.padEnd(12)} tasks=[${r.taskIds.join(',')}] waited>=${fmt(r.minWaitBeforeStartMs)} ` +
        `load=${fmt(r.loadMsDuringWait)} computed<=${fmt(r.maxComputeMs)} ` +
        `cached=${r.cachedPromptTokens ?? '?'} gen=${r.generatedTokens ?? '?'} ` +
        `-> ${r.dominant ?? '?'}${r.contextFull ? ' CONTEXT-FULL' : ''}` +
        `${r.inputTruncated ? ' INPUT-TRUNCATED' : ''}${r.pairedByLogOrder ? ' PAIRED-BY-ORDER' : ''}`
    )
  }
  out.push('', `contention: ${check.contention ? 'YES' : 'no'}`)
  for (const [a, b] of check.overlaps) {
    out.push(
      `  overlap: request ending ${new Date(a.end).toISOString().slice(11, 19)} and one ending ` +
        `${new Date(b.end).toISOString().slice(11, 19)}`
    )
  }
  for (const b of check.foreignModels) out.push(`  foreign model loaded: ${b.slice(0, 12)}`)
  for (const w of check.warnings) out.push(`  warning: ${w}`)
  return out.map((line) => line.replace(CONTROL_CHARS, '?'))
}

function* readEach(files: string[]): Generator<string[]> {
  for (const f of files) yield readFileSync(f, 'utf-8').split(/\r?\n/)
}

/** The command line; returns the exit code (throws on bad arguments or an unreadable log). */
export function main(argv: string[]): number {
  const logs: string[] = []
  let from: string | undefined
  let to: string | undefined
  let expectedBlob: string | undefined
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    // A missing value (or one swallowed by the next flag) must not quietly switch a check off.
    const value = (): string => {
      const v = argv[++i]
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`)
      return v
    }
    if (a === '--from') from = value()
    else if (a === '--to') to = value()
    else if (a === '--log') logs.push(value())
    else if (a === '--expected-blob') expectedBlob = value()
    else if (a === '--json') json = true
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!from || !to) throw new Error('--from and --to are required')

  const dir = join(process.env.LOCALAPPDATA ?? '', 'Ollama')
  const files = logs.length
    ? logs
    : readdirSync(dir)
        .filter((f) => /^server(-\d+)?\.log$/.test(f))
        .map((f) => join(dir, f))
  const report = analyzeLogs(readEach(files))
  const check = checkWindow(report, toWall(from, report), toWall(to, report), { expectedBlob })

  if (json) console.log(JSON.stringify(check, null, 2))
  else for (const line of renderText(report, check)) console.log(line)
  return check.contention ? 3 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
}
