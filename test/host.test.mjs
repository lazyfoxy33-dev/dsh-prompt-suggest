import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_CONFIG,
  LEARNING_DOMAIN_NAME,
  LEARNING_SYSTEM_PROMPT,
  MAX_REQUEST_BODY_BYTES,
  MAX_SEEN_KEYS,
  MAX_STORED_EXAMPLES,
  MAX_STORED_TEXT,
  NEGATIVE_CACHE_TTL_MS,
  PROMPT_SUGGEST_FEEDBACK_PATH,
  PROMPT_SUGGEST_LEARNING_PATH,
  PROMPT_SUGGEST_PATH,
  SYSTEM_PROMPT,
  apply,
  buildPrompt,
  createFeedbackHandler,
  createLearningDataHandler,
  createLearningStore,
  createSuggestHandler,
  extractTranscript,
  isDismissedSuggestion,
  latestCompletedTurn,
  normalizeConfig,
  normalizeLearningRecord,
  resolveModel,
  sanitizeSuggestion,
  suggestionCacheKey,
} from '../index.js'

const ROUTE_URL = 'http://dsh.internal/api/prompt.suggest'
const FEEDBACK_URL = 'http://dsh.internal/api/prompt.suggest.feedback'
const LEARNING_URL = 'http://dsh.internal/api/prompt.suggest.learning'

// ---------------------------------------------------------------------------
// Fake session events
// ---------------------------------------------------------------------------

let clockCursor = 1_000
function nextTime() {
  clockCursor += 1
  return clockCursor
}

function eventUser(seq, text, sourceKind = 'user') {
  // Real v4 logs store the UserMessage DIRECTLY as `user/message.data`;
  // assistant/message wraps its message in `{turn, step, message, stream}`.
  return {
    seq,
    type: 'user/message',
    time: nextTime(),
    surfaceOp: 'append',
    data: { id: `m${seq}`, role: 'user', content: [{ type: 'text', text }], source: { kind: sourceKind } },
  }
}

function eventAssistant(seq, text) {
  return {
    seq,
    type: 'assistant/message',
    time: nextTime(),
    surfaceOp: 'append',
    data: { turn: 1, step: 1, message: { id: `m${seq}`, role: 'assistant', content: [{ type: 'text', text }] } },
  }
}

function eventToolCall(seq, name, callId) {
  return {
    seq,
    type: 'tool/call',
    time: nextTime(),
    data: { turn: 1, step: 1, callId, name, arguments: '{}' },
  }
}

function eventToolResult(seq, callId, isError) {
  return {
    seq,
    type: 'tool/result',
    time: nextTime(),
    surfaceOp: 'append',
    data: { turn: 1, step: 1, message: { toolCallId: callId, isError, content: [{ type: 'text', text: isError ? 'failed' : 'ok' }] } },
  }
}

function turnEndEvent(seq, kind = 'completed') {
  return { seq, type: 'turn/end', time: nextTime(), data: { turn: 1, reason: { kind } } }
}

function requestHeaderEvent(seq, provider = 'deepseek', model = 'deepseek-v4-flash', reasoningEffort) {
  return {
    seq,
    type: 'request/header',
    time: nextTime(),
    data: {
      header: { config: { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) } },
      reason: 'initial',
    },
  }
}

function completedConversation(options = {}) {
  return [
    requestHeaderEvent(0, options.provider ?? 'deepseek', options.model ?? 'deepseek-v4-flash', options.reasoningEffort),
    eventUser(1, options.user ?? 'Fix the failing login test'),
    eventAssistant(2, options.assistant ?? 'I found the bug in auth.js.'),
    turnEndEvent(3),
  ]
}

// ---------------------------------------------------------------------------
// Fake services
// ---------------------------------------------------------------------------

function fakeSessionQuery(snapshot, options = {}) {
  const calls = { readSession: 0, readTitle: 0 }
  return {
    calls,
    async readSession(id) {
      calls.readSession += 1
      if (options.notFound === true) {
        const error = new Error('session not found')
        error.code = 'SESSION_QUERY_SESSION_NOT_FOUND'
        throw error
      }
      if (typeof snapshot === 'function') return snapshot(id)
      return snapshot
    },
    async readTitle() {
      calls.readTitle += 1
      if (options.titleError === true) throw new Error('title read failed')
      return options.title === undefined ? { title: 'Fix login test', messageSeqs: [], source: { kind: 'fallback' }, eventSeq: 1, updatedAt: 1 } : options.title
    },
  }
}

function abortError() {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

function finishReason(kind) {
  if (kind === 'error') return { kind: 'error', failure: { code: 'FAIL', message: 'secret failure detail' } }
  if (kind === 'aborted') return { kind: 'aborted', failure: { code: 'ABORTED', message: 'secret abort detail' } }
  return { kind }
}

function fakeLlm(options = {}) {
  const calls = []
  const llm = {
    calls,
    stream(request) {
      calls.push(request)
      return (async function* generate() {
        if (options.gate !== undefined) await options.gate
        if (options.throwOnCall === true) throw new Error('synthetic stream failure')
        if (options.waitForAbort === true) {
          await new Promise((resolve, reject) => {
            const signal = request.signal
            if (signal === undefined) {
              reject(new Error('missing signal'))
              return
            }
            if (signal.aborted) {
              reject(abortError())
              return
            }
            signal.addEventListener('abort', () => reject(abortError()), { once: true })
          })
        }
        const pieces = options.pieces ?? ['Run ', 'the failing tests']
        for (const piece of pieces) yield { type: 'text-delta', index: 0, text: piece }
        yield { type: 'finish', reason: finishReason(options.finishKind ?? 'stop') }
      })()
    },
  }
  return llm
}

function makeHandler(options = {}) {
  const events = options.events ?? completedConversation()
  const defaultQuery = fakeSessionQuery(
    { session: { id: 's1', cwd: '/work/demo' }, events },
    options.queryOptions,
  )
  const llm = 'llm' in options ? options.llm : fakeLlm()
  const deps = {
    config: options.config ?? {},
    now: options.now,
    sessions: 'sessions' in options ? options.sessions : { get: () => undefined },
    sessionQuery: 'sessionQuery' in options ? options.sessionQuery : defaultQuery,
    llm,
    agentDefaultModel:
      'agentDefaultModel' in options
        ? options.agentDefaultModel
        : { currentSelection: () => ({ provider: 'default-provider', model: 'default-model' }) },
    ...('learningStore' in options ? { learningStore: options.learningStore } : {}),
    ...(options.deps ?? {}),
  }
  if (deps.now === undefined) delete deps.now
  return { handler: createSuggestHandler(deps), llm, sessionQuery: deps.sessionQuery, defaultQuery, deps }
}

// ---------------------------------------------------------------------------
// Request/response helpers
// ---------------------------------------------------------------------------

function postRequest(sessionId, init = {}) {
  return new Request(ROUTE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
    ...init,
  })
}

function rawPost(body, init = {}) {
  return new Request(ROUTE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    ...init,
  })
}

function emptyRecord() {
  return {
    version: 1,
    updatedAt: 0,
    counts: { shown: 0, accepted: 0, dismissed: 0 },
    accepted: [],
    dismissed: [],
    seenKeys: [],
  }
}

function learningRecord(overrides = {}) {
  return {
    ...emptyRecord(),
    ...overrides,
    counts: { shown: 0, accepted: 0, dismissed: 0, ...(overrides.counts ?? {}) },
    accepted: overrides.accepted ?? [],
    dismissed: overrides.dismissed ?? [],
    seenKeys: overrides.seenKeys ?? [],
  }
}

/**
 * Fake storageDomain facility: one shared global document, one open handle at a
 * time (like the real facility's single-open-per-name rule), and the domain
 * spec's `global.schema.parse` applied on load like the real facility does.
 */
function fakeLearningFacility(initialValue = null) {
  const state = {
    value: initialValue,
    opens: 0,
    sets: 0,
    closes: 0,
    spec: undefined,
    openHandle: false,
  }
  return {
    state,
    async open(spec) {
      state.opens += 1
      state.spec = spec
      if (state.openHandle) throw new Error('domain already open')
      state.openHandle = true
      const readGlobal = () =>
        state.value === null || state.value === undefined
          ? spec.global.schema.parse(spec.global.initial)
          : spec.global.schema.parse(state.value)
      return {
        global: {
          get: readGlobal,
          async set(value) {
            state.sets += 1
            state.value = JSON.parse(JSON.stringify(value))
          },
        },
        async close() {
          state.closes += 1
          state.openHandle = false
        },
      }
    },
  }
}

function seededLearningStore(recordValue) {
  const facility = fakeLearningFacility(recordValue)
  const store = createLearningStore({ openDomain: () => facility, now: () => 1234 })
  return { store, facility }
}

function feedbackRequest(body) {
  return rawPost(JSON.stringify(body))
}

function learningDataRequest() {
  return new Request(LEARNING_URL, { method: 'GET' })
}

function fakeApplyCtx(services = {}) {
  const routes = []
  const disposers = []
  const reads = []
  const ctx = {
    connection: {
      fetch: {
        register(route) {
          routes.push(route)
          return () => {}
        },
      },
    },
    get(key) {
      reads.push(key)
      return services[key]
    },
    effect(callback) {
      disposers.push(callback())
    },
  }
  return { ctx, routes, disposers, reads }
}

async function readJson(response) {
  const text = await response.text()
  return { status: response.status, headers: response.headers, body: JSON.parse(text), text }
}

// ---------------------------------------------------------------------------
// Pure helpers: config
// ---------------------------------------------------------------------------

test('normalizeConfig supplies contract defaults and validates overrides', () => {
  const defaults = normalizeConfig()
  assert.deepEqual(defaults, DEFAULT_CONFIG)
  assert.ok(Object.isFrozen(defaults))
  assert.deepEqual(DEFAULT_CONFIG, {
    enabled: true,
    provider: '',
    model: '',
    maxSuggestionChars: 96,
    contextMessages: 10,
    maxToolEntries: 6,
    messageTextLimit: 480,
    maxPromptChars: 8000,
    maxTokens: 256,
    temperature: null,
    timeoutMs: 20000,
    cacheTtlMs: 600000,
    cacheMaxEntries: 32,
    reasoningEffort: '',
    learningEnabled: true,
    maxLearningExamples: 8,
    maxLearningChars: 160,
  })

  const custom = normalizeConfig({
    enabled: false,
    provider: '  p  ',
    model: 'm',
    maxSuggestionChars: 20,
    contextMessages: 3,
    timeoutMs: 5000,
    temperature: 0.2,
    reasoningEffort: ' low ',
    ignoredKey: 'ignored',
  })
  assert.equal(custom.enabled, false)
  assert.equal(custom.provider, 'p')
  assert.equal(custom.model, 'm')
  assert.equal(custom.maxSuggestionChars, 20)
  assert.equal(custom.contextMessages, 3)
  assert.equal(custom.timeoutMs, 5000)
  assert.equal(custom.temperature, 0.2)
  assert.equal(custom.reasoningEffort, 'low')
  assert.equal('ignoredKey' in custom, false)

  const clamped = normalizeConfig({
    maxSuggestionChars: 1,
    contextMessages: 0,
    temperature: 9,
    timeoutMs: Number.NaN,
    cacheTtlMs: -5,
    reasoningEffort: 7,
  })
  assert.equal(clamped.maxSuggestionChars, 8)
  assert.equal(clamped.contextMessages, 1)
  assert.equal(clamped.temperature, 2)
  assert.equal(clamped.timeoutMs, DEFAULT_CONFIG.timeoutMs)
  assert.equal(clamped.cacheTtlMs, 0)
  assert.equal(clamped.reasoningEffort, '')
  assert.equal(normalizeConfig({ maxToolEntries: 999 }).maxToolEntries, 100)
  assert.equal(normalizeConfig({ maxToolEntries: -3 }).maxToolEntries, 0)
  assert.equal(normalizeConfig({ maxToolEntries: 'many' }).maxToolEntries, DEFAULT_CONFIG.maxToolEntries)
  assert.equal(normalizeConfig(null).enabled, true)
  assert.equal(normalizeConfig({ enabled: 'no' }).enabled, true)

  assert.equal(normalizeConfig({ learningEnabled: false }).learningEnabled, false)
  assert.equal(normalizeConfig({ learningEnabled: 'no' }).learningEnabled, true)
  assert.equal(normalizeConfig({ maxLearningExamples: 999 }).maxLearningExamples, 20)
  assert.equal(normalizeConfig({ maxLearningExamples: -1 }).maxLearningExamples, 0)
  assert.equal(normalizeConfig({ maxLearningExamples: 'many' }).maxLearningExamples, DEFAULT_CONFIG.maxLearningExamples)
  assert.equal(normalizeConfig({ maxLearningChars: 1 }).maxLearningChars, 16)
  assert.equal(normalizeConfig({ maxLearningChars: 99999 }).maxLearningChars, 400)
  assert.equal(normalizeConfig({ maxLearningChars: 'wide' }).maxLearningChars, DEFAULT_CONFIG.maxLearningChars)
})

test('normalizeLearningRecord sanitizes and caps the durable record', () => {
  const empty = emptyRecord()
  assert.deepEqual(normalizeLearningRecord(undefined), empty)
  assert.deepEqual(normalizeLearningRecord(null), empty)
  assert.deepEqual(normalizeLearningRecord('nope'), empty)
  assert.deepEqual(normalizeLearningRecord([]), empty)

  const normalized = normalizeLearningRecord({
    version: 99,
    updatedAt: 42.9,
    counts: { shown: 9, accepted: -2, dismissed: 3.7 },
    accepted: [
      { text: '  Run   the tests  ', at: 5 },
      { text: 'RUN THE TESTS', at: 6 },
      { text: '   ', at: 7 },
      { text: 42 },
      'short form',
    ],
    dismissed: [{ text: 'Commit the changes', at: 'later' }],
    seenKeys: ['s1:3', 's1:3', 42, '  s2:4  '],
    ignored: 'x',
  })
  assert.deepEqual(normalized, {
    version: 1,
    updatedAt: 42,
    counts: { shown: 9, accepted: 0, dismissed: 3 },
    accepted: [
      { text: 'Run the tests', at: 5 },
      { text: 'short form', at: 0 },
    ],
    dismissed: [{ text: 'Commit the changes', at: 0 }],
    seenKeys: ['s1:3', 's2:4'],
  })

  // Control characters are stripped from stored example text.
  assert.deepEqual(normalizeLearningRecord({ accepted: [{ text: 'a\u0000b\nc\td', at: 1 }] }).accepted, [{ text: 'abcd', at: 1 }])

  // Stored caps: 12 examples/list, 200 chars/text, 50 seen keys.
  assert.equal(normalizeLearningRecord({ accepted: [{ text: 'x'.repeat(500), at: 1 }] }).accepted[0].text.length, MAX_STORED_TEXT)
  assert.equal(
    normalizeLearningRecord({ accepted: Array.from({ length: 30 }, (_, index) => ({ text: `example ${index}`, at: index })) }).accepted.length,
    MAX_STORED_EXAMPLES,
  )
  assert.equal(
    normalizeLearningRecord({ seenKeys: Array.from({ length: 80 }, (_, index) => `s${index}:${index}`) }).seenKeys.length,
    MAX_SEEN_KEYS,
  )
})

// ---------------------------------------------------------------------------
// Pure helpers: completed-turn detection
// ---------------------------------------------------------------------------

test('latestCompletedTurn requires the final turn to end completed', () => {
  const completed = [eventUser(1, 'hi'), turnEndEvent(2, 'completed')]
  assert.deepEqual(latestCompletedTurn(completed), { upToSeq: 2 })

  assert.equal(latestCompletedTurn([eventUser(1, 'hi'), turnEndEvent(2, 'aborted')]), undefined)
  assert.equal(latestCompletedTurn([eventUser(1, 'hi'), turnEndEvent(2, 'interrupted')]), undefined)
  assert.equal(latestCompletedTurn([eventUser(1, 'hi')]), undefined)
  assert.equal(latestCompletedTurn(undefined), undefined)
  assert.equal(latestCompletedTurn([]), undefined)
  assert.equal(latestCompletedTurn([null, 42, 'x']), undefined)

  // A start after the boundary means the turn is still running.
  assert.equal(
    latestCompletedTurn([...completed, { seq: 3, type: 'turn/start', data: { turn: 2, step: 1 } }, eventUser(4, 'again')]),
    undefined,
  )

  // Plain events after the boundary do not move it.
  assert.deepEqual(latestCompletedTurn([...completed, { seq: 3, type: 'session/title', data: { title: 'T' } }]), { upToSeq: 2 })

  // The last turn/end decides.
  assert.equal(
    latestCompletedTurn([turnEndEvent(1, 'completed'), { seq: 2, type: 'turn/start', data: { turn: 2 } }, turnEndEvent(3, 'aborted')]),
    undefined,
  )
})

// ---------------------------------------------------------------------------
// Pure helpers: transcript extraction
// ---------------------------------------------------------------------------

test('extractTranscript keeps the last contextMessages messages', () => {
  const events = []
  let seq = 0
  for (let index = 1; index <= 12; index += 1) {
    events.push(eventUser(seq, `user ${index}`))
    seq += 1
    events.push(eventAssistant(seq, `assistant ${index}`))
    seq += 1
  }
  events.push(turnEndEvent(seq))

  const { text, lastUserText } = extractTranscript(events, { contextMessages: 4 })
  assert.match(text, /User: user 12/)
  assert.match(text, /Assistant: assistant 12/)
  assert.match(text, /User: user 11/)
  assert.match(text, /Assistant: assistant 11/)
  assert.doesNotMatch(text, /User: user 10/)
  assert.equal(lastUserText, 'user 12')
})

test('extractTranscript truncates each message and bounds the total prompt size', () => {
  const long = 'x'.repeat(100)
  const truncated = extractTranscript([eventUser(1, long), turnEndEvent(2)], { messageTextLimit: 32 })
  assert.equal(truncated.entries.length, 1)
  assert.equal(truncated.entries[0].text.length, 32)

  const many = []
  let seq = 0
  for (let index = 0; index < 20; index += 1) {
    many.push(eventUser(seq, `user message ${index} `.repeat(20)))
    seq += 1
    many.push(eventAssistant(seq, `assistant reply ${index} `.repeat(20)))
    seq += 1
  }
  const bounded = extractTranscript(many, { contextMessages: 10, maxPromptChars: 256 })
  assert.ok(bounded.text.length <= 256, `expected <= 256 chars, got ${bounded.text.length}`)
  assert.match(bounded.text, /reply 19/)
  assert.doesNotMatch(bounded.text, /reply 10/)
})

test('extractTranscript includes compact tool activity and ignores failed-only noise', () => {
  const events = [
    eventUser(0, 'fix the test'),
    eventToolCall(1, 'bash', 'call-1'),
    eventToolResult(2, 'call-1', true),
    eventToolCall(3, 'grep', 'call-2'),
    eventToolResult(4, 'call-2', false),
    eventAssistant(5, 'the test fails because of auth'),
    turnEndEvent(6),
  ]
  const { text, lastUserText } = extractTranscript(events, {})
  assert.match(text, /Tool: bash/)
  assert.match(text, /Tool failed: bash/)
  assert.match(text, /Tool: grep/)
  assert.doesNotMatch(text, /Tool failed: grep/)
  assert.match(text, /User: fix the test/)
  assert.match(text, /Assistant: the test fails because of auth/)
  assert.equal(lastUserText, 'fix the test')
})

test('extractTranscript reads the real user/message shape and drops injected context', () => {
  const events = [
    eventUser(0, '这是注入的运行时上下文，不是用户输入', 'runtime-context'),
    eventUser(1, 'please fix the login test'),
    eventToolCall(2, 'bash', 'call-1'),
    eventAssistant(3, 'I fixed the login test'),
    turnEndEvent(4),
  ]
  const { text, lastUserText } = extractTranscript(events, {})
  assert.match(text, /User: please fix the login test/)
  assert.doesNotMatch(text, /运行时上下文/)
  assert.equal(lastUserText, 'please fix the login test')

  // A skill catalog, time context, or skill injection is never a user message.
  for (const sourceKind of ['skill-catalog', 'time-context', 'subagent-settled', 'runtime-context']) {
    const injectedOnly = extractTranscript([eventUser(0, 'injected', sourceKind), turnEndEvent(1)], {})
    assert.equal(injectedOnly.lastUserText, '')
    assert.doesNotMatch(injectedOnly.text, /injected/)
  }
})

test('extractTranscript caps tool rows and trims tool noise before dialogue', () => {
  const events = [eventUser(0, 'long tool loop request')]
  let seq = 1
  for (let index = 0; index < 40; index += 1) events.push(eventToolCall(seq++, 'bash', `call-${index}`))
  events.push(eventAssistant(seq++, 'done with the long tool loop'))
  events.push(turnEndEvent(seq))

  const capped = extractTranscript(events, { maxToolEntries: 3 })
  assert.equal(capped.entries.filter((entry) => entry.role === 'tool').length, 3)
  assert.match(capped.text, /User: long tool loop request/)
  assert.match(capped.text, /Assistant: done with the long tool loop/)

  const trimmed = extractTranscript(events, { maxToolEntries: 40, maxPromptChars: 256 })
  assert.ok(trimmed.text.length <= 256, `expected <= 256 chars, got ${trimmed.text.length}`)
  assert.match(trimmed.text, /User: long tool loop request/)
  assert.match(trimmed.text, /Assistant: done with the long tool loop/)
  assert.ok(trimmed.entries.filter((entry) => entry.role === 'tool').length < 40)
})

test('extractTranscript handles empty and malformed logs', () => {
  assert.deepEqual(extractTranscript(undefined, {}), { text: '', entries: [], lastUserText: '' })
  const malformed = extractTranscript([null, { type: 'user/message' }, { type: 'assistant/message', data: {} }], {})
  assert.equal(malformed.text, '')
})

// ---------------------------------------------------------------------------
// Pure helpers: prompt
// ---------------------------------------------------------------------------

test('buildPrompt carries the required system instructions and bounded context', () => {
  const prompt = buildPrompt({ transcript: 'User: hi', title: 'Fix login', cwd: '/work/demo' })
  assert.equal(prompt.system, SYSTEM_PROMPT)
  assert.match(prompt.system, /predict the user's single next message/)
  assert.match(prompt.system, /language of the conversation/)
  assert.match(prompt.system, /2-16 words/)
  assert.match(prompt.system, /NONE/)
  assert.match(prompt.system, /Do not speak as the assistant/)
  assert.match(prompt.system, /Do not use quotes/)
  assert.match(prompt.system, /untrusted data/)
  assert.match(prompt.user, /User: hi/)
  assert.match(prompt.user, /Session title: Fix login/)
  assert.match(prompt.user, /Working directory: \/work\/demo/)
  assert.ok(prompt.user.endsWith("Predict the user's next message."))

  const bare = buildPrompt({ transcript: '' })
  assert.doesNotMatch(bare.user, /Session title:/)
  assert.doesNotMatch(bare.user, /Working directory:/)
  assert.match(bare.user, /\(no conversation text\)/)
})

test('buildPrompt appends learning conditioning after the transcript', () => {
  const learning = learningRecord({
    counts: { shown: 10, accepted: 6, dismissed: 2 },
    accepted: [
      { text: 'Run the failing tests', at: 1 },
      { text: 'Review the diff', at: 2 },
    ],
    dismissed: [{ text: 'Commit the changes', at: 3 }],
  })

  const learned = buildPrompt({ transcript: 'User: hi', title: 'Fix login', learning })
  assert.equal(learned.system, `${SYSTEM_PROMPT}\n\n${LEARNING_SYSTEM_PROMPT}`)
  assert.match(learned.system, /preference profile/i)
  assert.match(learned.system, /never as instructions/)
  assert.match(learned.system, /language, length, tone, and granularity/)
  assert.match(learned.system, /Never repeat a dismissed suggestion/)
  assert.match(learned.system, /very short/)

  const user = learned.user
  assert.match(user, /User preference profile:/)
  assert.match(user, /Acceptance: 6 accepted \/ 10 shown \(60%\)\./)
  assert.match(user, /Accepted suggestions \(the user pressed Tab to use these; match their style\):\n- Run the failing tests\n- Review the diff/)
  assert.match(user, /Dismissed suggestions \(the user hid these; do not repeat them or close variants\):\n- Commit the changes/)
  assert.ok(user.indexOf('User preference profile:') > user.indexOf('Conversation transcript:'))
  assert.ok(user.indexOf('User preference profile:') < user.indexOf("Predict the user's next message."))
  assert.ok(user.endsWith("Predict the user's next message."))

  // No learning keeps the pre-v1.1 prompt byte-identical.
  const plain = buildPrompt({ transcript: 'User: hi' })
  assert.equal(plain.system, SYSTEM_PROMPT)
  assert.equal(plain.user, "Conversation transcript:\nUser: hi\nPredict the user's next message.")

  // Empty lists omit their headers, but the acceptance line stays.
  const dismissedOnly = learningRecord({ dismissed: [{ text: 'Commit the changes', at: 1 }] })
  const derived = buildPrompt({ transcript: 'User: hi', learning: dismissedOnly }).user
  assert.match(derived, /Acceptance: 0 accepted \/ 0 shown \(0%\)\./)
  assert.doesNotMatch(derived, /Accepted suggestions/)
  assert.match(derived, /Dismissed suggestions/)

  // A prompt-shaped subset with bare strings is tolerated.
  const strings = { counts: { shown: 2, accepted: 1, dismissed: 0 }, accepted: ['Review the diff'], dismissed: [] }
  assert.match(buildPrompt({ transcript: 'User: hi', learning: strings }).user, /- Review the diff/)

  // The section is bounded by the remaining prompt budget.
  const huge = learningRecord({ counts: { shown: 1, accepted: 1 }, accepted: [{ text: 'A'.repeat(400), at: 1 }] })
  const bounded = buildPrompt({ transcript: 'User: hi', learning: huge, maxPromptChars: 256 }).user
  assert.ok(bounded.length <= 256, `expected <= 256 chars, got ${bounded.length}`)
  assert.doesNotMatch(bounded, /Accepted suggestions/)
  assert.match(bounded, /User preference profile:/)
})

// ---------------------------------------------------------------------------
// Pure helpers: sanitization
// ---------------------------------------------------------------------------

test('sanitizeSuggestion strips formatting and rejects non-suggestions', () => {
  assert.equal(sanitizeSuggestion('  Run the tests.  ', {}), 'Run the tests')
  assert.equal(sanitizeSuggestion('"Review the diff."', {}), 'Review the diff')
  assert.equal(sanitizeSuggestion('`Commit the changes`', {}), 'Commit the changes')
  assert.equal(sanitizeSuggestion('```\nRun the failing tests\n```', {}), 'Run the failing tests')
  assert.equal(sanitizeSuggestion('```text\nReview the diff.\n```', {}), 'Review the diff')
  assert.equal(sanitizeSuggestion('Suggestion: Fix the bug', {}), 'Fix the bug')
  assert.equal(sanitizeSuggestion('Suggestion: "Fix the bug."', {}), 'Fix the bug')
  assert.equal(sanitizeSuggestion('建议：运行测试', {}), '运行测试')
  assert.equal(sanitizeSuggestion('Line one\n\nline   two', {}), 'Line one line two')

  for (const rejected of ['NONE', 'NONE.', 'none', 'None.', '无', 'N/A', '  ', '', null, undefined, 42, {}]) {
    assert.equal(sanitizeSuggestion(rejected, {}), null, `expected ${JSON.stringify(rejected)} to be rejected`)
  }
})

test('sanitizeSuggestion rejects repetition and enforces the length contract', () => {
  assert.equal(sanitizeSuggestion('Run the failing tests', { lastUserText: 'Run the failing tests' }), null)
  assert.equal(sanitizeSuggestion('Run the failing tests', { lastUserText: '  run   the failing tests ' }), null)
  // Trailing punctuation is normalized on BOTH sides before comparison.
  assert.equal(sanitizeSuggestion('Run the failing tests.', { lastUserText: 'Run the failing tests' }), null)
  assert.equal(sanitizeSuggestion('Run the failing tests', { lastUserText: 'Run the failing tests.' }), null)
  assert.equal(sanitizeSuggestion('运行测试。', { lastUserText: '运行测试。' }), null)
  assert.equal(sanitizeSuggestion('运行测试', { lastUserText: '运行测试。' }), null)
  assert.equal(sanitizeSuggestion('运行测试。', { lastUserText: '运行测试' }), null)
  assert.equal(sanitizeSuggestion('Run the failing tests!', { lastUserText: 'Fix the login flow' }), 'Run the failing tests!')

  const limit = 20
  assert.equal(sanitizeSuggestion('a'.repeat(2 * limit + 1), { maxSuggestionChars: limit }), null)

  const truncated = sanitizeSuggestion('word '.repeat(6).trim(), { maxSuggestionChars: limit })
  assert.ok(truncated !== null)
  assert.ok(truncated.length <= limit)
  assert.equal(truncated, 'word word word word')

  // Exactly 2x is still truncated down to the limit, not rejected.
  const exactDouble = sanitizeSuggestion('ab '.repeat(12).trim(), { maxSuggestionChars: limit })
  assert.ok(exactDouble !== null)
  assert.ok(exactDouble.length <= limit)
})

test('isDismissedSuggestion matches exact and close repeat candidates only', () => {
  const learning = learningRecord({
    dismissed: [
      { text: 'Run the failing tests', at: 1 },
      { text: 'Commit the changes', at: 2 },
      { text: '运行测试', at: 3 },
    ],
  })
  assert.equal(isDismissedSuggestion('Run the failing tests', learning), true)
  assert.equal(isDismissedSuggestion('  RUN   the failing tests.  ', learning), true)
  assert.equal(isDismissedSuggestion('Run the failing test', learning), true)
  assert.equal(isDismissedSuggestion('Commit the changes!', learning), true)
  assert.equal(isDismissedSuggestion('运行测试。', learning), true)
  assert.equal(isDismissedSuggestion('Review the diff', learning), false)
  assert.equal(isDismissedSuggestion('', learning), false)
  assert.equal(isDismissedSuggestion(undefined, learning), false)
  assert.equal(isDismissedSuggestion('Run the failing tests', undefined), false)

  // Containment needs both a >=8-character shorter side and an 80% ratio.
  const shortDismissed = learningRecord({ dismissed: [{ text: 'fix it', at: 1 }] })
  assert.equal(isDismissedSuggestion('fix it', shortDismissed), true)
  assert.equal(isDismissedSuggestion('fix it now', shortDismissed), false)
  const longDismissed = learningRecord({ dismissed: [{ text: 'please run all the tests now', at: 1 }] })
  assert.equal(isDismissedSuggestion('run all the tests', longDismissed), false)
})

// ---------------------------------------------------------------------------
// Pure helpers: model resolution + cache key
// ---------------------------------------------------------------------------

test('resolveModel follows the explicit config -> header -> default chain', () => {
  const agentDefaultModel = { currentSelection: () => ({ provider: 'default-p', model: 'default-m' }) }
  assert.deepEqual(
    resolveModel({
      config: { provider: 'cfg-p', model: 'cfg-m' },
      requestHeader: { config: { provider: 'header-p', model: 'header-m' } },
      agentDefaultModel,
    }),
    { provider: 'cfg-p', model: 'cfg-m' },
  )
  assert.deepEqual(
    resolveModel({ config: {}, requestHeader: { config: { provider: 'header-p', model: 'header-m' } }, agentDefaultModel }),
    { provider: 'header-p', model: 'header-m' },
  )
  assert.deepEqual(resolveModel({ config: {}, agentDefaultModel }), { provider: 'default-p', model: 'default-m' })
  assert.equal(resolveModel({ config: { provider: 'cfg-p' }, requestHeader: undefined, agentDefaultModel: {} }), undefined)
  assert.equal(resolveModel({ config: {}, requestHeader: { config: { provider: 'only-p' } }, agentDefaultModel: {} }), undefined)
  assert.equal(resolveModel({}), undefined)
  assert.equal(
    resolveModel({ config: {}, requestHeader: undefined, agentDefaultModel: { currentSelection: () => { throw new Error('boom') } } }),
    undefined,
  )
})

test('suggestionCacheKey separates sessions and completed-turn boundaries', () => {
  assert.equal(suggestionCacheKey('s1', 3), 's1\u00003')
  assert.notEqual(suggestionCacheKey('s1', 3), suggestionCacheKey('s1', 4))
  assert.notEqual(suggestionCacheKey('s1', 3), suggestionCacheKey('s2', 3))
  assert.notEqual(suggestionCacheKey('a', 12), suggestionCacheKey('a1', 2))
})

// ---------------------------------------------------------------------------
// Pure helpers: durable learning store
// ---------------------------------------------------------------------------

test('createLearningStore opens the declared domain lazily and persists through it', async () => {
  const facility = fakeLearningFacility()
  const store = createLearningStore({ openDomain: () => facility, now: () => 111 })
  assert.equal(facility.state.opens, 0, 'the domain must open lazily')

  const initial = await store.read()
  assert.deepEqual(initial, emptyRecord())
  assert.equal(facility.state.opens, 1)

  const spec = facility.state.spec
  assert.equal(spec.name, LEARNING_DOMAIN_NAME)
  assert.equal(spec.version, 1)
  assert.equal(spec.layout, 'single')
  assert.deepEqual(spec.tables, {})
  assert.deepEqual(spec.global.initial, emptyRecord())
  assert.deepEqual(spec.global.schema.parse(null), emptyRecord())
  assert.deepEqual(spec.global.schema.parse({ odd: true }), { odd: true })

  const updated = await store.update((record) => {
    record.counts.shown += 1
    record.accepted.unshift({ text: 'Run the tests', at: 111 })
    return record
  })
  assert.equal(updated.counts.shown, 1)
  assert.deepEqual(updated.accepted, [{ text: 'Run the tests', at: 111 }])
  assert.equal(facility.state.sets, 1)

  // A fresh store instance reads the previous instance's durable write.
  await store.close()
  assert.equal(facility.state.closes, 1)
  const second = createLearningStore({ openDomain: () => facility })
  const persisted = await second.read()
  assert.equal(persisted.counts.shown, 1)
  assert.deepEqual(persisted.accepted.map((example) => example.text), ['Run the tests'])
  await second.close()
})

test('createLearningStore serializes concurrent updates', async () => {
  const { store } = seededLearningStore(emptyRecord())
  const results = await Promise.all([
    store.update((record) => {
      record.counts.shown += 1
      return record
    }),
    store.update((record) => {
      record.counts.shown += 1
      return record
    }),
    store.update((record) => {
      record.counts.shown += 1
      return record
    }),
  ])
  assert.equal(results[2].counts.shown, 3)
  assert.equal((await store.read()).counts.shown, 3)
  await store.close()
})

test('createLearningStore falls back to memory when storage is absent or failing', async () => {
  for (const openDomain of [() => undefined, () => { throw new Error('storage exploded') }]) {
    const store = createLearningStore({ openDomain })
    assert.deepEqual(await store.read(), emptyRecord())
    const updated = await store.update((record) => {
      record.counts.dismissed += 1
      record.dismissed.unshift({ text: 'Commit the changes', at: 1 })
      return record
    })
    assert.equal(updated.counts.dismissed, 1)
    assert.deepEqual(updated.dismissed, [{ text: 'Commit the changes', at: 1 }])
    assert.equal((await store.read()).counts.dismissed, 1)
    await store.close()
  }
})

test('createLearningStore reads are detached and corrupt storage is healed', async () => {
  const facility = fakeLearningFacility(
    learningRecord({
      counts: { shown: 2, accepted: 1, dismissed: 0 },
      accepted: [{ text: 'Review the diff', at: 3 }],
      seenKeys: ['s1:3'],
    }),
  )
  const store = createLearningStore({ openDomain: () => facility })
  const first = await store.read()
  first.counts.shown = 99
  first.accepted.push({ text: 'mutated', at: 0 })
  const second = await store.read()
  assert.equal(second.counts.shown, 2)
  assert.deepEqual(second.accepted.map((example) => example.text), ['Review the diff'])
  await store.close()

  const corrupt = createLearningStore({ openDomain: () => fakeLearningFacility('not-a-record') })
  assert.deepEqual(await corrupt.read(), emptyRecord())
  await corrupt.close()
})

// ---------------------------------------------------------------------------
// Plugin entry: route registration
// ---------------------------------------------------------------------------

test('apply registers the suggestion, feedback, and learning-data routes without touching services', () => {
  const { ctx, routes, reads } = fakeApplyCtx()

  apply(ctx, {})

  assert.equal(reads.length, 0, 'optional services must only be resolved per request')
  assert.deepEqual(
    routes.map((route) => route.path),
    [PROMPT_SUGGEST_PATH, PROMPT_SUGGEST_FEEDBACK_PATH, PROMPT_SUGGEST_LEARNING_PATH],
  )
  assert.deepEqual(
    routes.map((route) => route.methods),
    [['POST'], ['POST'], ['GET']],
  )
  for (const route of routes) {
    assert.equal(route.requestBody, 'buffered')
    assert.equal(typeof route.fetch, 'function')
  }
})

test('apply route resolves optional services lazily through ctx.get', async () => {
  const services = {
    sessions: { get: () => undefined },
    sessionQuery: fakeSessionQuery({
      session: { id: 's1', cwd: '/work/demo' },
      events: completedConversation(),
    }),
    llm: fakeLlm(),
    agentDefaultModel: { currentSelection: () => ({ provider: 'default-p', model: 'default-m' }) },
  }
  const { ctx, routes, reads } = fakeApplyCtx(services)

  apply(ctx, { maxSuggestionChars: 40 })
  assert.equal(reads.length, 0)

  const result = await readJson(await routes[0].fetch(postRequest('s1')))
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(result.body.suggestion.text, 'Run the failing tests')
  assert.equal(result.body.suggestion.provider, 'deepseek')
  assert.ok(reads.includes('sessions'))
  assert.ok(reads.includes('sessionQuery'))
  assert.ok(reads.includes('llm'))
})

test('apply honors a disabled config', async () => {
  const { ctx, routes } = fakeApplyCtx()
  apply(ctx, { enabled: false })
  const result = await readJson(await routes[0].fetch(postRequest('s1')))
  assert.deepEqual(result.body, { ok: true, suggestion: null, reason: 'disabled' })
})

test('apply closes the learning store on dispose', async () => {
  const facility = fakeLearningFacility()
  const { ctx, routes, disposers } = fakeApplyCtx({ storageDomain: facility })
  apply(ctx, {})

  await readJson(await routes[1].fetch(feedbackRequest({ sessionId: 's1', upToSeq: 3, action: 'shown' })))
  assert.equal(facility.state.opens, 1)
  assert.equal(facility.state.closes, 0)
  assert.equal(disposers.length, 1)

  await disposers[0]()
  assert.equal(facility.state.closes, 1)
})

test('apply wires the suggestion route to the feedback-persisted record', async () => {
  const facility = fakeLearningFacility()
  const services = {
    sessions: { get: () => undefined },
    sessionQuery: fakeSessionQuery({ session: { id: 's1', cwd: '/work/demo' }, events: completedConversation() }),
    llm: fakeLlm(),
    agentDefaultModel: { currentSelection: () => ({ provider: 'default-p', model: 'default-m' }) },
    storageDomain: facility,
  }
  const { ctx, routes, reads } = fakeApplyCtx(services)
  apply(ctx, {})

  const feedback = await readJson(
    await routes[1].fetch(feedbackRequest({ sessionId: 's1', upToSeq: 3, action: 'accept', text: 'Review the diff' })),
  )
  assert.deepEqual(feedback.body, { ok: true, counts: { shown: 0, accepted: 1, dismissed: 0 } })
  assert.deepEqual(reads, ['storageDomain'], 'the feedback route must not read a Session')

  const suggestion = await readJson(await routes[0].fetch(postRequest('s1')))
  assert.equal(suggestion.body.ok, true)
  assert.equal(services.llm.calls[0].system, `${SYSTEM_PROMPT}\n\n${LEARNING_SYSTEM_PROMPT}`)
  assert.match(services.llm.calls[0].messages[0].content[0].text, /- Review the diff/)

  const learningData = await readJson(await routes[2].fetch(learningDataRequest()))
  assert.deepEqual(learningData.body.counts, { shown: 0, accepted: 1, dismissed: 0 })
  assert.deepEqual(learningData.body.accepted.map((example) => example.text), ['Review the diff'])
})

// ---------------------------------------------------------------------------
// Handler: learning-data route ("学习数据" sidebar page)
// ---------------------------------------------------------------------------

test('apply serves learning data without any Session service', async () => {
  const facility = fakeLearningFacility(
    learningRecord({ counts: { shown: 1, accepted: 1 }, accepted: [{ text: 'Review the diff', at: 1 }] }),
  )
  const { ctx, routes, reads } = fakeApplyCtx({ storageDomain: facility })
  apply(ctx, {})

  const result = await readJson(await routes[2].fetch(learningDataRequest()))
  assert.equal(result.status, 200)
  assert.equal(result.body.counts.accepted, 1)
  assert.deepEqual(result.body.accepted.map((example) => example.text), ['Review the diff'])
  assert.deepEqual(reads, ['storageDomain'], 'learning data must not read a Session')
})

function makeLearningDataHandler(store, config = {}) {
  return createLearningDataHandler({ config, store })
}

test('learning-data GET returns the normalized record with examples', async () => {
  const facility = fakeLearningFacility(
    learningRecord({
      updatedAt: 987,
      counts: { shown: 7, accepted: 4, dismissed: 2 },
      accepted: [
        { text: '  Run   the tests\u0000 ', at: 6 },
        { text: 'Review the diff', at: 5 },
        { text: 'RUN THE TESTS', at: 4 },
      ],
      dismissed: [{ text: 'Commit the changes', at: 3 }, { text: 42 }],
      seenKeys: ['s1:3'],
      ignored: 'x',
    }),
  )
  const store = createLearningStore({ openDomain: () => facility })
  const response = await makeLearningDataHandler(store)(learningDataRequest())

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.match(response.headers.get('content-type'), /application\/json/)
  const result = await readJson(response)
  assert.deepEqual(result.body, {
    ok: true,
    counts: { shown: 7, accepted: 4, dismissed: 2 },
    accepted: [
      { text: 'Run the tests', at: 6 },
      { text: 'Review the diff', at: 5 },
    ],
    dismissed: [{ text: 'Commit the changes', at: 3 }],
    updatedAt: 987,
  })
})

test('learning-data GET returns zeros for an empty store', async () => {
  const store = createLearningStore({ openDomain: () => undefined })
  const result = await readJson(await makeLearningDataHandler(store)(learningDataRequest()))
  assert.deepEqual(result.body, {
    ok: true,
    counts: { shown: 0, accepted: 0, dismissed: 0 },
    accepted: [],
    dismissed: [],
    updatedAt: 0,
  })
})

test('learning-data GET degrades to the empty record without storage', async () => {
  const empty = {
    ok: true,
    counts: { shown: 0, accepted: 0, dismissed: 0 },
    accepted: [],
    dismissed: [],
    updatedAt: 0,
  }

  const noStore = await readJson(await createLearningDataHandler({})(learningDataRequest()))
  assert.equal(noStore.status, 200)
  assert.deepEqual(noStore.body, empty)

  const injected = await readJson(
    await createLearningDataHandler({ store: { read: async () => learningRecord({ counts: { shown: 2, accepted: 1 } }) } })(learningDataRequest()),
  )
  assert.equal(injected.body.counts.accepted, 1)

  const secret = 'TOP-SECRET-STORAGE-TEXT'
  const failingStore = {
    async read() {
      throw new Error(`storage exploded: ${secret}`)
    },
  }
  const failed = await readJson(await makeLearningDataHandler(failingStore)(learningDataRequest()))
  assert.equal(failed.status, 200)
  assert.deepEqual(failed.body, empty)
  assert.equal(failed.text.includes(secret), false)
})

test('learning-data route rejects non-GET methods', async () => {
  const handler = makeLearningDataHandler(createLearningStore({ openDomain: () => undefined }))
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const response = await handler(new Request(LEARNING_URL, { method }))
    assert.equal(response.status, 405, method)
    const result = await readJson(response)
    assert.deepEqual(result.body, { ok: false, error: 'method-not-allowed' })
    assert.equal(result.headers.get('allow'), 'GET')
  }
})

test('learning data is readable when learningEnabled is false', async () => {
  const { store } = seededLearningStore(
    learningRecord({ counts: { shown: 2, accepted: 1, dismissed: 0 }, accepted: [{ text: 'Review the diff', at: 1 }] }),
  )
  const handler = createLearningDataHandler({ config: { learningEnabled: false }, store })
  const result = await readJson(await handler(learningDataRequest()))
  assert.equal(result.body.ok, true)
  assert.equal(result.body.counts.accepted, 1)
  assert.deepEqual(result.body.accepted, [{ text: 'Review the diff', at: 1 }])
})

// ---------------------------------------------------------------------------
// Handler: request validation
// ---------------------------------------------------------------------------

test('invalid request bodies return a strict 400 JSON error', async () => {
  const { handler, sessionQuery } = makeHandler()

  const notJson = await handler(rawPost('not json'))
  assert.equal(notJson.status, 400)
  assert.deepEqual((await readJson(notJson)).body, { ok: false, error: 'invalid-request' })
  assert.equal(notJson.headers.get('cache-control'), 'no-store')
  assert.match(notJson.headers.get('content-type'), /application\/json/)

  for (const body of [JSON.stringify({ sessionId: 42 }), JSON.stringify({ sessionId: '' }), JSON.stringify({}), JSON.stringify([]), JSON.stringify(null)]) {
    const response = await handler(rawPost(body))
    assert.equal(response.status, 400, `expected 400 for ${body}`)
    assert.deepEqual((await readJson(response)).body, { ok: false, error: 'invalid-request' })
  }

  const oversized = await handler(rawPost(JSON.stringify({ sessionId: 's1', padding: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 100) })))
  assert.equal(oversized.status, 400)

  const noBody = await handler(new Request(ROUTE_URL, { method: 'POST' }))
  assert.equal(noBody.status, 400)

  assert.equal(sessionQuery.calls.readSession, 0, 'invalid bodies must not touch session services')
})

test('non-POST methods return 405 without throwing', async () => {
  const { handler } = makeHandler()
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const response = await handler(new Request(ROUTE_URL, { method }))
    assert.equal(response.status, 405)
    const result = await readJson(response)
    assert.deepEqual(result.body, { ok: false, error: 'method-not-allowed' })
    assert.equal(result.headers.get('allow'), 'POST')
  }
})

test('unknown sessions return 404 and never leak service error text', async () => {
  const { handler, llm } = makeHandler({ queryOptions: { notFound: true } })
  const response = await handler(postRequest('missing-session'))
  assert.equal(response.status, 404)
  assert.deepEqual((await readJson(response)).body, { ok: false, error: 'session-not-found' })
  assert.equal(llm.calls.length, 0)

  const bare = makeHandler({ sessions: undefined, sessionQuery: undefined })
  assert.equal((await bare.handler(postRequest('missing-session'))).status, 404)
})

test('unexpected session-read failures return an opaque 500', async () => {
  const secret = 'TOP-SECRET-STORAGE-TEXT'
  const exploding = {
    calls: { readSession: 0, readTitle: 0 },
    async readSession() {
      this.calls.readSession += 1
      throw new Error(`storage exploded: ${secret}`)
    },
    async readTitle() {
      return undefined
    },
  }
  const { handler } = makeHandler({ sessionQuery: exploding })
  const response = await handler(postRequest('s1'))
  assert.equal(response.status, 500)
  const result = await readJson(response)
  assert.deepEqual(result.body, { ok: false, error: 'internal' })
  assert.equal(result.text.includes(secret), false)
})

// ---------------------------------------------------------------------------
// Handler: gating and pipeline degradation
// ---------------------------------------------------------------------------

test('disabled config returns disabled before touching services', async () => {
  const { handler, llm, sessionQuery } = makeHandler({ config: { enabled: false } })
  const result = await readJson(await handler(postRequest('s1')))
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { ok: true, suggestion: null, reason: 'disabled' })
  assert.equal(llm.calls.length, 0)
  assert.equal(sessionQuery.calls.readSession, 0)
})

test('no completed turn returns no-completed-turn and skips the LLM', async () => {
  const events = [eventUser(0, 'hi'), eventAssistant(1, 'hello'), turnEndEvent(2, 'aborted')]
  const { handler, llm } = makeHandler({ events })
  const result = await readJson(await handler(postRequest('s1')))
  assert.deepEqual(result.body, { ok: true, suggestion: null, reason: 'no-completed-turn' })
  assert.equal(llm.calls.length, 0)
})

test('no resolvable model returns no-model', async () => {
  const events = [eventUser(0, 'hi'), eventAssistant(1, 'hello'), turnEndEvent(2)]
  const { handler, llm } = makeHandler({ events, agentDefaultModel: { currentSelection: () => undefined } })
  const result = await readJson(await handler(postRequest('s1')))
  assert.deepEqual(result.body, { ok: true, suggestion: null, reason: 'no-model' })
  assert.equal(llm.calls.length, 0)
})

test('missing llm service returns llm-unavailable', async () => {
  const { handler } = makeHandler({ llm: undefined })
  const result = await readJson(await handler(postRequest('s1')))
  assert.deepEqual(result.body, { ok: true, suggestion: null, reason: 'llm-unavailable' })
})

test('LLM error, abort, and thrown streams all collapse to llm-error', async () => {
  for (const options of [{ finishKind: 'error' }, { finishKind: 'aborted' }, { throwOnCall: true }]) {
    const { handler } = makeHandler({ llm: fakeLlm(options) })
    const result = await readJson(await handler(postRequest('s1')))
    assert.deepEqual(result.body, { ok: true, suggestion: null, reason: 'llm-error' }, JSON.stringify(options))
  }
})

test('empty, NONE, and repeated-user output collapse to empty', async () => {
  for (const options of [{ pieces: [] }, { pieces: ['NONE'] }, { pieces: ['Fix the failing ', 'login test'] }]) {
    const { handler } = makeHandler({ llm: fakeLlm(options) })
    const result = await readJson(await handler(postRequest('s1')))
    assert.deepEqual(result.body, { ok: true, suggestion: null, reason: 'empty' }, JSON.stringify(options))
  }
})

test('a stalled LLM call is aborted by the configured timeout', async () => {
  const { handler } = makeHandler({ llm: fakeLlm({ waitForAbort: true }), config: { timeoutMs: 25 } })
  const started = Date.now()
  const result = await readJson(await handler(postRequest('s1')))
  assert.equal(Date.now() - started < 5000, true)
  assert.deepEqual(result.body, { ok: true, suggestion: null, reason: 'llm-error' })
})

test('an already-aborted request signal skips the LLM call', async () => {
  const controller = new AbortController()
  controller.abort()
  const { handler, llm } = makeHandler()
  const request = {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify({ sessionId: 's1' }),
    signal: controller.signal,
  }
  const result = await readJson(await handler(request))
  assert.deepEqual(result.body, { ok: true, suggestion: null, reason: 'llm-error' })
  assert.equal(llm.calls.length, 0)
})

// ---------------------------------------------------------------------------
// Handler: success path
// ---------------------------------------------------------------------------

test('success returns a sanitized suggestion with route metadata', async () => {
  const query = fakeSessionQuery(
    { session: { id: 's1', cwd: '/work/demo' }, events: completedConversation({ provider: 'header-p', model: 'header-m' }) },
    { title: 'Fix login' },
  )
  const llm = fakeLlm({ pieces: ['Suggestion: "Run the ', 'failing tests."'] })
  const { handler } = makeHandler({ sessionQuery: query, llm })

  const response = await handler(postRequest('s1'))
  assert.equal(response.status, 200)
  const result = await readJson(response)
  assert.deepEqual(result.body, {
    ok: true,
    suggestion: {
      text: 'Run the failing tests',
      upToSeq: 3,
      provider: 'header-p',
      model: 'header-m',
    },
  })
  assert.equal(result.headers.get('cache-control'), 'no-store')
  assert.match(result.headers.get('content-type'), /application\/json/)
  assert.deepEqual(Object.keys(result.body.suggestion), ['text', 'upToSeq', 'provider', 'model'])

  const call = llm.calls[0]
  assert.equal(call.provider, 'header-p')
  assert.equal(call.model, 'header-m')
  assert.equal(call.system, SYSTEM_PROMPT)
  assert.equal(call.maxTokens, DEFAULT_CONFIG.maxTokens)
  assert.equal('temperature' in call, false)
  assert.ok(call.signal instanceof AbortSignal)
  assert.equal(call.messages.length, 1)
  assert.equal(call.messages[0].role, 'user')
  assert.equal(call.messages[0].content[0].type, 'text')
  const promptText = call.messages[0].content[0].text
  assert.match(promptText, /Session title: Fix login/)
  assert.match(promptText, /Working directory: \/work\/demo/)
  assert.match(promptText, /User: Fix the failing login test/)
  assert.match(promptText, /Assistant: I found the bug in auth.js\./)
  assert.ok(promptText.endsWith("Predict the user's next message."))
})

test('a runtime that only implements prepareCall still generates a suggestion', async () => {
  const dispatched = []
  const llm = {
    // Deliberately no `stream`: this exercises the prepareCall-only check.
    async prepareCall(config) {
      return {
        config,
        stream(request) {
          dispatched.push(request)
          return (async function* generate() {
            yield { type: 'text-delta', index: 0, text: 'Review the diff' }
            yield { type: 'finish', reason: finishReason('stop') }
          })()
        },
      }
    },
  }
  const { handler } = makeHandler({ llm })
  const result = await readJson(await handler(postRequest('s1')))
  assert.equal(result.body.ok, true)
  assert.equal(result.body.suggestion.text, 'Review the diff')
  assert.equal(dispatched.length, 1)
})

test('a runtime with prepareCall dispatches the prepared config with the least reasoning effort', async () => {
  const prepared = []
  const dispatched = []
  const llm = {
    stream() {
      throw new Error('the raw stream path must not run when prepareCall is available')
    },
    async prepareCall(config, signal, configure) {
      prepared.push({ config, hasSignal: signal instanceof AbortSignal })
      const modelInfo = { reasoning: { efforts: [{ id: 'minimal' }, { id: 'high' }] } }
      const selected = configure === undefined ? config : configure(config, modelInfo)
      const resolved = { ...config, ...selected }
      return {
        config: resolved,
        stream(request) {
          dispatched.push(request)
          return (async function* generate() {
            yield { type: 'text-delta', index: 0, text: 'Commit the changes' }
            yield { type: 'finish', reason: finishReason('stop') }
          })()
        },
      }
    },
  }
  const query = fakeSessionQuery(
    {
      session: { id: 's1', cwd: '/work/demo' },
      events: completedConversation({ provider: 'header-p', model: 'header-m', reasoningEffort: 'high' }),
    },
    { title: 'Fix login' },
  )
  const { handler } = makeHandler({ llm, sessionQuery: query })
  const result = await readJson(await handler(postRequest('s1')))

  assert.equal(result.body.ok, true)
  assert.equal(result.body.suggestion.text, 'Commit the changes')
  assert.equal(prepared.length, 1)
  assert.equal(prepared[0].hasSignal, true)
  assert.equal(prepared[0].config.provider, 'header-p')
  assert.equal(prepared[0].config.model, 'header-m')
  // The session's own high reasoning effort must not leak into this cheap call.
  assert.equal('reasoningEffort' in prepared[0].config, false)
  assert.equal('temperature' in prepared[0].config, false)
  assert.equal(dispatched.length, 1)
  assert.equal(dispatched[0].reasoningEffort, 'minimal')
  assert.equal('temperature' in dispatched[0], false)
  assert.equal(dispatched[0].maxTokens, DEFAULT_CONFIG.maxTokens)
  assert.equal(dispatched[0].messages[0].role, 'user')
  assert.equal(dispatched[0].messages[0].content[0].type, 'text')
  assert.match(dispatched[0].messages[0].content[0].text, /Conversation transcript:/)

  // An explicit config effort is respected instead of the model's least effort.
  const overriddenDispatches = []
  const overriddenLlm = {
    async prepareCall(config, signal, configure) {
      const modelInfo = { reasoning: { efforts: [{ id: 'minimal' }, { id: 'high' }] } }
      const selected = configure === undefined ? config : configure(config, modelInfo)
      return {
        config: { ...config, ...selected },
        stream(request) {
          overriddenDispatches.push(request)
          return (async function* generate() {
            yield { type: 'text-delta', index: 0, text: 'Continue the task' }
            yield { type: 'finish', reason: finishReason('stop') }
          })()
        },
      }
    },
  }
  const overridden = makeHandler({ llm: overriddenLlm, config: { reasoningEffort: 'low' } })
  const overriddenResult = await readJson(await overridden.handler(postRequest('s1')))
  assert.equal(overriddenResult.body.ok, true)
  assert.equal(overriddenDispatches[0].reasoningEffort, 'low')
})

test('explicit config route and sampling controls override the session header', async () => {
  const llm = fakeLlm()
  const { handler } = makeHandler({
    llm,
    config: { provider: 'cfg-p', model: 'cfg-m', maxTokens: 64, temperature: 0.1, reasoningEffort: 'low' },
  })
  const result = await readJson(await handler(postRequest('s1')))
  assert.equal(result.body.suggestion.provider, 'cfg-p')
  assert.equal(result.body.suggestion.model, 'cfg-m')
  assert.equal(llm.calls[0].maxTokens, 64)
  assert.equal(llm.calls[0].temperature, 0.1)
  assert.equal(llm.calls[0].reasoningEffort, 'low')
})

test('agent default model selection is the last route fallback', async () => {
  const events = [eventUser(0, 'hi'), eventAssistant(1, 'hello'), turnEndEvent(2)]
  const llm = fakeLlm()
  const { handler } = makeHandler({
    events,
    llm,
    agentDefaultModel: { currentSelection: () => ({ provider: 'default-p', model: 'default-m' }) },
  })
  const result = await readJson(await handler(postRequest('s1')))
  assert.equal(result.body.ok, true)
  assert.equal(result.body.suggestion.provider, 'default-p')
  assert.equal(result.body.suggestion.model, 'default-m')
})

test('a live session is used without the session-query service', async () => {
  const events = completedConversation()
  const live = {
    id: 'live-1',
    seq: events.length,
    header: { id: 'live-1', cwd: '/repo/live' },
    snapshotEvents: () => events,
    requestHeader: () => ({ config: { provider: 'live-p', model: 'live-m' }, tools: [] }),
    deriveMessages: () => [],
  }
  const llm = fakeLlm()
  const { handler } = makeHandler({
    llm,
    sessions: { get: (id) => (id === 'live-1' ? live : undefined) },
    sessionQuery: undefined,
  })

  const result = await readJson(await handler(postRequest('live-1')))
  assert.equal(result.body.ok, true)
  assert.equal(result.body.suggestion.provider, 'live-p')
  assert.equal(result.body.suggestion.model, 'live-m')
  assert.match(llm.calls[0].messages[0].content[0].text, /Working directory: \/repo\/live/)
  assert.match(llm.calls[0].messages[0].content[0].text, /User: Fix the failing login test/)

  assert.equal((await handler(postRequest('other-session'))).status, 404)
})

test('title lookup failures are ignored', async () => {
  const query = fakeSessionQuery({ session: { id: 's1', cwd: '/w' }, events: completedConversation() }, { titleError: true })
  const { handler } = makeHandler({ sessionQuery: query, llm: fakeLlm() })
  const result = await readJson(await handler(postRequest('s1')))
  assert.equal(result.body.ok, true)
})

// ---------------------------------------------------------------------------
// Handler: learning store, feedback route, and conditioning
// ---------------------------------------------------------------------------

function makeFeedbackHandler(store, config = {}) {
  return createFeedbackHandler({ store, config, now: () => 4242 })
}

test('feedback records shown once per completed turn', async () => {
  const store = createLearningStore({ openDomain: () => undefined })
  const handler = makeFeedbackHandler(store)

  let result = await readJson(await handler(feedbackRequest({ sessionId: 's1', upToSeq: 3, action: 'shown' })))
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('cache-control'), 'no-store')
  assert.match(result.headers.get('content-type'), /application\/json/)
  assert.deepEqual(result.body, { ok: true, counts: { shown: 1, accepted: 0, dismissed: 0 } })
  result = await readJson(await handler(feedbackRequest({ sessionId: 's1', upToSeq: 3, action: 'shown' })))
  assert.deepEqual(result.body, { ok: true, counts: { shown: 1, accepted: 0, dismissed: 0 } })
  result = await readJson(await handler(feedbackRequest({ sessionId: 's1', upToSeq: 4, action: 'shown' })))
  assert.deepEqual(result.body, { ok: true, counts: { shown: 2, accepted: 0, dismissed: 0 } })

  const record = await store.read()
  assert.deepEqual(record.seenKeys, ['s1:4', 's1:3'])
})

test('feedback records accept and dismiss examples newest first', async () => {
  const store = createLearningStore({ openDomain: () => undefined })
  const handler = makeFeedbackHandler(store)

  await handler(feedbackRequest({ sessionId: 's1', upToSeq: 3, action: 'accept', text: '  Review   the diff. ' }))
  await handler(feedbackRequest({ sessionId: 's1', upToSeq: 3, action: 'accept', text: 'review the diff.' }))
  await handler(feedbackRequest({ sessionId: 's1', upToSeq: 3, action: 'dismiss', text: 'Commit the changes' }))

  const record = await store.read()
  assert.deepEqual(record.counts, { shown: 0, accepted: 2, dismissed: 1 })
  assert.deepEqual(record.accepted.map((example) => example.text), ['review the diff.'])
  assert.equal(record.accepted[0].at, 4242)
  assert.deepEqual(record.dismissed.map((example) => example.text), ['Commit the changes'])
})

test('feedback reset clears the record', async () => {
  const store = createLearningStore({ openDomain: () => undefined })
  const handler = makeFeedbackHandler(store)

  await handler(feedbackRequest({ sessionId: 's1', upToSeq: 3, action: 'shown' }))
  await handler(feedbackRequest({ sessionId: 's1', upToSeq: 3, action: 'accept', text: 'Review the diff' }))
  const result = await readJson(await handler(feedbackRequest({ sessionId: 's1', upToSeq: 3, action: 'reset' })))

  assert.deepEqual(result.body, { ok: true, counts: { shown: 0, accepted: 0, dismissed: 0 } })
  const record = await store.read()
  assert.deepEqual(record, emptyRecord())
  assert.equal(record.updatedAt, 0)
})

test('feedback reset accepts the panel payload without a session', async () => {
  const store = createLearningStore({ openDomain: () => undefined })
  const handler = makeFeedbackHandler(store)
  await handler(feedbackRequest({ sessionId: 's1', upToSeq: 3, action: 'shown' }))
  await handler(feedbackRequest({ sessionId: 's1', upToSeq: 3, action: 'accept', text: 'Review the diff' }))

  // The learning-data panel clears with only the action.
  const result = await readJson(await handler(feedbackRequest({ action: 'reset' })))
  assert.deepEqual(result.body, { ok: true, counts: { shown: 0, accepted: 0, dismissed: 0 } })
  assert.deepEqual(await store.read(), emptyRecord())

  // Every other action still requires the session identifiers.
  for (const body of [{ action: 'shown' }, { action: 'accept', text: 'Run the tests' }, { action: 'dismiss', text: 'Run the tests' }]) {
    const response = await handler(feedbackRequest(body))
    assert.equal(response.status, 400, JSON.stringify(body))
  }
})

test('feedback validates its body and method strictly', async () => {
  const store = createLearningStore({ openDomain: () => undefined })
  const handler = makeFeedbackHandler(store)

  const invalidBodies = [
    {},
    [],
    { sessionId: '', upToSeq: 3, action: 'shown' },
    { sessionId: 42, upToSeq: 3, action: 'shown' },
    { sessionId: 's1', upToSeq: -1, action: 'shown' },
    { sessionId: 's1', upToSeq: 1.5, action: 'shown' },
    { sessionId: 's1', upToSeq: '3', action: 'shown' },
    { sessionId: 's1', upToSeq: 3, action: 'like' },
    { sessionId: 's1', upToSeq: 3, action: 'accept' },
    { sessionId: 's1', upToSeq: 3, action: 'accept', text: '' },
    { sessionId: 's1', upToSeq: 3, action: 'dismiss', text: 42 },
    { sessionId: 's1', upToSeq: 3, action: 'accept', text: 'x'.repeat(513) },
  ]
  for (const body of invalidBodies) {
    const response = await handler(feedbackRequest(body))
    assert.equal(response.status, 400, JSON.stringify(body))
    assert.deepEqual((await readJson(response)).body, { ok: false, error: 'invalid-request' })
  }

  const method = await handler(new Request(FEEDBACK_URL, { method: 'GET' }))
  assert.equal(method.status, 405)
  assert.deepEqual((await readJson(method)).body, { ok: false, error: 'method-not-allowed' })

  const oversized = await handler(
    rawPost(JSON.stringify({ sessionId: 's1', upToSeq: 1, action: 'shown', padding: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 100) })),
  )
  assert.equal(oversized.status, 400)

  assert.deepEqual(await store.read(), emptyRecord(), 'rejected bodies must not write')
})

test('feedback is ignored when learning is disabled', async () => {
  const store = createLearningStore({ openDomain: () => undefined })
  await store.update((record) => {
    record.counts.accepted = 1
    record.accepted = [{ text: 'Run the tests', at: 1 }]
    return record
  })
  const handler = makeFeedbackHandler(store, { learningEnabled: false })

  const result = await readJson(await handler(feedbackRequest({ sessionId: 's1', upToSeq: 3, action: 'accept', text: 'Review the diff' })))
  assert.deepEqual(result.body, { ok: true, counts: { shown: 0, accepted: 1, dismissed: 0 } })
  const record = await store.read()
  assert.equal(record.counts.accepted, 1)
  assert.deepEqual(record.accepted.map((example) => example.text), ['Run the tests'])

  // The panel may still clear the data while learning is disabled.
  const reset = await readJson(await handler(feedbackRequest({ action: 'reset' })))
  assert.deepEqual(reset.body, { ok: true, counts: { shown: 0, accepted: 0, dismissed: 0 } })
  assert.deepEqual(await store.read(), emptyRecord())
})

test('a persisted learning record conditions the prompt and system instruction', async () => {
  const { store } = seededLearningStore(
    learningRecord({
      counts: { shown: 4, accepted: 2, dismissed: 1 },
      accepted: [{ text: 'Review the diff', at: 1 }],
      dismissed: [{ text: 'Commit the changes', at: 2 }],
    }),
  )
  const llm = fakeLlm()
  const { handler } = makeHandler({ llm, learningStore: store })

  const result = await readJson(await handler(postRequest('s1')))
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  const call = llm.calls[0]
  assert.equal(call.system, `${SYSTEM_PROMPT}\n\n${LEARNING_SYSTEM_PROMPT}`)
  const promptText = call.messages[0].content[0].text
  assert.match(promptText, /User preference profile:/)
  assert.match(promptText, /Acceptance: 2 accepted \/ 4 shown \(50%\)\./)
  assert.match(promptText, /- Review the diff/)
  assert.match(promptText, /- Commit the changes/)
})

test('config bounds how many examples and characters reach the prompt', async () => {
  const longText = 'Please run the entire failing test suite once more'
  const { store } = seededLearningStore(
    learningRecord({
      counts: { shown: 5, accepted: 3, dismissed: 0 },
      accepted: [
        { text: 'Run the failing tests', at: 3 },
        { text: longText, at: 2 },
        { text: 'Review the diff', at: 1 },
      ],
    }),
  )
  const llm = fakeLlm()
  const { handler } = makeHandler({ llm, learningStore: store, config: { maxLearningExamples: 1, maxLearningChars: 40 } })

  await handler(postRequest('s1'))
  const promptText = llm.calls[0].messages[0].content[0].text
  assert.match(promptText, /- Run the failing tests\n/)
  assert.doesNotMatch(promptText, /Review the diff/)
  assert.doesNotMatch(promptText, /Please run/)

  const truncated = seededLearningStore(
    learningRecord({ counts: { shown: 1, accepted: 1 }, accepted: [{ text: longText, at: 1 }] }),
  )
  const truncatedLlm = fakeLlm()
  const { handler: truncatedHandler } = makeHandler({
    llm: truncatedLlm,
    learningStore: truncated.store,
    config: { maxLearningChars: 16 },
  })
  await truncatedHandler(postRequest('s1'))
  assert.match(truncatedLlm.calls[0].messages[0].content[0].text, /- Please run the e\n/)
})

test('a dismissed candidate from the store is suppressed with reason dismissed', async () => {
  const { store } = seededLearningStore(learningRecord({ dismissed: [{ text: 'Run the failing tests', at: 1 }] }))
  for (const llmOutput of ['Run the failing tests', 'Run the failing test']) {
    const llm = fakeLlm({ pieces: [llmOutput] })
    const { handler } = makeHandler({ llm, learningStore: store })
    const result = await readJson(await handler(postRequest('s1')))
    assert.deepEqual(result.body, { ok: true, suggestion: null, reason: 'dismissed' }, llmOutput)
  }
})

test('a dissimilar candidate is not filtered by a dismissal', async () => {
  const { store } = seededLearningStore(learningRecord({ dismissed: [{ text: 'Commit the changes', at: 1 }] }))
  const llm = fakeLlm({ pieces: ['Run the failing tests'] })
  const { handler } = makeHandler({ llm, learningStore: store })
  const result = await readJson(await handler(postRequest('s1')))
  assert.equal(result.body.ok, true)
  assert.equal(result.body.suggestion.text, 'Run the failing tests')
})

test('learningEnabled false ignores the stored record and its dismissed filter', async () => {
  const { store } = seededLearningStore(
    learningRecord({
      counts: { shown: 1, accepted: 1 },
      accepted: [{ text: 'Review the diff', at: 1 }],
      dismissed: [{ text: 'Run the failing tests', at: 1 }],
    }),
  )
  const llm = fakeLlm({ pieces: ['Run the failing tests'] })
  const { handler } = makeHandler({ llm, learningStore: store, config: { learningEnabled: false } })

  const result = await readJson(await handler(postRequest('s1')))
  assert.equal(result.body.ok, true)
  assert.equal(result.body.suggestion.text, 'Run the failing tests')
  assert.equal(llm.calls[0].system, SYSTEM_PROMPT)
  assert.doesNotMatch(llm.calls[0].messages[0].content[0].text, /User preference profile:/)
})

test('a request-body learning field is ignored; only the store conditions the prompt', async () => {
  const llm = fakeLlm()
  const { handler } = makeHandler({ llm })
  const body = JSON.stringify({ sessionId: 's1', learning: { counts: { shown: 1, accepted: 1 }, accepted: ['Review the diff'] } })
  const result = await readJson(await handler(rawPost(body)))
  assert.equal(result.body.ok, true)
  assert.equal(llm.calls[0].system, SYSTEM_PROMPT)
  assert.doesNotMatch(llm.calls[0].messages[0].content[0].text, /User preference profile:/)
})

test('learning does not change the per-turn cache key', async () => {
  const { store } = seededLearningStore(learningRecord({ accepted: [{ text: 'Review the diff', at: 1 }] }))
  const llm = fakeLlm()
  const { handler } = makeHandler({ llm, learningStore: store })

  const first = await readJson(await handler(postRequest('s1')))
  await store.update((record) => {
    record.accepted.unshift({ text: 'Commit the changes', at: 2 })
    return record
  })
  const second = await readJson(await handler(postRequest('s1')))
  assert.equal(llm.calls.length, 1)
  assert.deepEqual(second.body, first.body)
})

test('a dismissal recorded after caching suppresses the cached suggestion', async () => {
  const store = createLearningStore({ openDomain: () => undefined })
  const llm = fakeLlm()
  const { handler } = makeHandler({ llm, learningStore: store })
  const feedback = createFeedbackHandler({ store, now: () => 9 })

  // First request: positive suggestion cached for this completed turn.
  const first = await readJson(await handler(postRequest('s1')))
  assert.equal(first.body.ok, true)
  assert.equal(first.body.suggestion.text, 'Run the failing tests')
  assert.equal(llm.calls.length, 1)

  // Dismiss that exact suggestion afterwards (same session and upToSeq).
  await feedback(feedbackRequest({ sessionId: 's1', upToSeq: 3, action: 'dismiss', text: 'Run the failing tests' }))

  // A cache hit must still honor the newly recorded dismissal, without a new LLM call.
  const second = await readJson(await handler(postRequest('s1')))
  assert.deepEqual(second.body, { ok: true, suggestion: null, reason: 'dismissed' })
  assert.equal(llm.calls.length, 1, 'the cache hit must not call the LLM again')

  // The cached positive entry was not overwritten: clearing the record restores it.
  await feedback(feedbackRequest({ sessionId: 's1', upToSeq: 3, action: 'reset' }))
  const third = await readJson(await handler(postRequest('s1')))
  assert.equal(third.body.ok, true)
  assert.equal(third.body.suggestion.text, 'Run the failing tests')
  assert.equal(llm.calls.length, 1)
})

// ---------------------------------------------------------------------------
// Handler: cache and coalescing
// ---------------------------------------------------------------------------

test('a cache hit avoids a second LLM call', async () => {
  const llm = fakeLlm()
  const { handler } = makeHandler({ llm })
  const first = await readJson(await handler(postRequest('s1')))
  const second = await readJson(await handler(postRequest('s1')))
  assert.equal(llm.calls.length, 1)
  assert.deepEqual(second.body, first.body)
})

test('negative results are cached with the short TTL', async () => {
  let now = 0
  const llm = fakeLlm({ pieces: ['NONE'] })
  const { handler } = makeHandler({ llm, now: () => now })

  await handler(postRequest('s1'))
  now = NEGATIVE_CACHE_TTL_MS - 1
  await handler(postRequest('s1'))
  assert.equal(llm.calls.length, 1)

  now = NEGATIVE_CACHE_TTL_MS
  await handler(postRequest('s1'))
  assert.equal(llm.calls.length, 2)
})

test('positive cache entries expire with cacheTtlMs via the fake clock', async () => {
  let now = 1_000
  const llm = fakeLlm()
  const { handler } = makeHandler({ llm, now: () => now, config: { cacheTtlMs: 500 } })

  await handler(postRequest('s1'))
  now = 1_100
  await handler(postRequest('s1'))
  assert.equal(llm.calls.length, 1)

  now = 1_500
  await handler(postRequest('s1'))
  assert.equal(llm.calls.length, 2)
})

test('cache eviction respects cacheMaxEntries', async () => {
  let now = 0
  const llm = fakeLlm()
  const { handler } = makeHandler({ llm, now: () => now, config: { cacheMaxEntries: 1 } })

  await handler(postRequest('s1'))
  await handler(postRequest('s2'))
  await handler(postRequest('s1'))
  assert.equal(llm.calls.length, 3)
})

test('concurrent identical requests coalesce into one LLM call', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const llm = fakeLlm({ gate })
  const { handler } = makeHandler({ llm })

  const first = handler(postRequest('s1'))
  const second = handler(postRequest('s1'))
  await new Promise((resolve) => setImmediate(resolve))
  release()

  const [left, right] = await Promise.all([first, second])
  assert.equal(llm.calls.length, 1)
  const leftBody = await readJson(left)
  const rightBody = await readJson(right)
  assert.equal(leftBody.body.ok, true)
  assert.deepEqual(rightBody.body, leftBody.body)
})

// ---------------------------------------------------------------------------
// Handler: privacy
// ---------------------------------------------------------------------------

test('responses never contain conversation text or provider failure detail', async () => {
  const secret = 'TOP-SECRET-USER-TEXT'
  const events = [eventUser(0, secret), eventAssistant(1, 'secret assistant reply'), turnEndEvent(2)]

  const failing = makeHandler({ events, llm: fakeLlm({ finishKind: 'error' }) })
  const failedResponse = await failing.handler(postRequest('s1'))
  const failedText = await failedResponse.text()
  assert.equal(failedText.includes(secret), false)
  assert.equal(failedText.includes('secret assistant reply'), false)
  assert.equal(failedText.includes('secret failure detail'), false)
  assert.deepEqual(JSON.parse(failedText), { ok: true, suggestion: null, reason: 'llm-error' })

  const empty = makeHandler({ events, llm: fakeLlm({ pieces: ['NONE'] }) })
  const emptyText = await (await empty.handler(postRequest('s1'))).text()
  assert.equal(emptyText.includes(secret), false)
  assert.deepEqual(JSON.parse(emptyText), { ok: true, suggestion: null, reason: 'empty' })
})
