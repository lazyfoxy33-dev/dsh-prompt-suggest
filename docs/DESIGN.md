# dsh-prompt-suggest — implementation contract

Goal: after an assistant reply finishes, the composer area shows a predicted **next user prompt**
generated from the conversation (OpenAI Codex "Composer predictions" behaviour: suggestion appears,
**Tab accepts it into the input box without sending**, click accepts too, user can edit or ignore).

Shipped as one persistent profile bundle (`dsh-prompt-suggest`) with a Host half
(`index.js`) and a Web Client half (`client.js`).

Reference: https://help.openai.com/en/articles/20001601-composer-predictions-in-codex
(one complete next message, Tab inserts into composer, never sends, may not appear every turn.)

## Host half — `index.js`

Must be dependency-free ESM (`node --check` and `node --test` must work from the package dir).

Exports:

```js
export const name = 'prompt-suggest'
export const inject = ['connection']
export function apply(ctx, config) { /* register one route, fiber-owned */ }
```

Also export the pure helpers used by tests (same module, no side effects at import time):
`normalizeConfig`, `latestCompletedTurn`, `extractTranscript`, `buildPrompt`, `sanitizeSuggestion`,
`resolveModel`, `suggestionCacheKey`, and a `createSuggestHandler(deps)`-style seam that tests can call
with fake `{ sessions, sessionQuery, llm, agentDefaultModel }` services and a fake clock.

### Route

Call `ctx.connection.fetch.register(route)` **bare** in `apply` — the connection service already
registers the route as a fiber-owned effect (shipped `session-log-export` does the same), so do not wrap
it in another `ctx.effect`. The route is:

```js
{
  path: '/api/prompt.suggest',
  methods: ['POST'],
  requestBody: 'buffered',
  fetch: async (request) => Response,   // JSON only, cache-control: no-store
}
```

Request body: `{"sessionId":"<session id>"}` (reject non-string/empty/oversized body > 16 KiB → 400).
Response 200 JSON:

```json
{"ok":true,"suggestion":{"text":"Run the failing tests","upToSeq":42,"provider":"p","model":"m"}}
{"ok":true,"suggestion":null,"reason":"no-completed-turn"|"empty"|"llm-unavailable"|"no-model"|"llm-error"}
```

400 `{"ok":false,"error":"invalid-request"}`, 404 `{"ok":false,"error":"session-not-found"}`,
405 wrong method (the route layer may already handle non-POST; do not crash).
Never include conversation text in the response or in errors/logs.

### Pipeline

1. `ctx.get('sessions')` → `sessions.get(id)` gives a live `Session`; `session.seq` is latest seq,
   `session.deriveMessages()` returns `Message[]`, `session.requestHeader()` gives
   `{ config: { provider, model, ... } } | undefined`.
   Fallback for non-live sessions: `ctx.get('sessionQuery')?.readSession(id)` →
   `{ session, events }`; take latest seq from the last event.
   Real event shapes (v4): `user/message.data` IS the `UserMessage`
   (`{id, role, content, source}`) — accept it only when `data.source.kind === 'user'`, because the
   runtime also stores injected context as `user/message` with other source kinds
   (`runtime-context`, `skill-catalog`, `time-context`, `subagent-settled`); `assistant/message.data`
   wraps `{turn, step, message, stream}`; `tool/call.data` is `{turn, step, callId, name, arguments}`;
   `tool/result.data.message` is the tool message.
2. Completed turn required: last `turn/end` event in the log must have `data.reason.kind === 'completed'`
   (equivalently, a live session whose last turn ended completed). Otherwise return `no-completed-turn`.
3. Transcript: walk events ascending, keep text from human `user/message` (`source.kind === 'user'`),
   `assistant/message` (text blocks), and compact tool activity: summarize each `tool/call` from its
   `description`/recognized command action/path hint and append `(ok)` or `(failed)` from the matching
   `tool/result`; never render raw command arguments. Keep the last `config.contextMessages` user/assistant
   texts (default 10), each truncated to `config.messageTextLimit` (default 480) chars; cap tool rows to the
   most recent `config.maxToolEntries` (default 6); total transcript bounded by `config.maxPromptChars`
   (default 8000) by dropping tool rows first and then the oldest remaining entries, so the latest request
   and reply survive longest. Derive `completedActions` (`commit`, `push`) only from successful tool calls
   after the latest human message, and pass them to `buildPrompt` as an explicit
   `Completed actions in the latest turn: …` line. Include session title if
   `ctx.get('sessionQuery')?.readTitle(id)` resolves (best effort, ignore failure) and `cwd` from the
   header when present.
4. Model: `config.provider` + `config.model` when both set; else `session.requestHeader()?.config`
   provider/model (live) or the last `request/header` event (its `reasoningEffort` is deliberately NOT
   reused: this auxiliary call stays cheap, so only an explicit `config.reasoningEffort` is passed);
   else
   `ctx.get('agentDefaultModel')?.currentSelection()`. No route → `suggestion:null, reason:'no-model'`.
5. Call the LLM through `llm.prepareCall(...)` (least reasoning effort via `configure`) and dispatch with
   `prepared.stream({ ...prepared.config, system, messages, signal })`; fall back to `llm.stream(...)` when
   `prepareCall` is unavailable. `temperature` is omitted unless config sets a number (reasoning models
   reject it); `ctx.get('llm')` supplies the service; `messages` is one synthetic user turn:
   `[{ role: 'user', content: [{ type: 'text', text: promptText }] }]`.
   Collect `text-delta` chunks (`chunk.text`). `chunk.type === 'finish'` with
   `reason.kind === 'error' | 'aborted'` → null + `reason:'llm-error'`. Ignore `reasoning-delta`.
   `signal` combines `request.signal` and `AbortSignal.timeout(config.timeoutMs)`.
6. Sanitize output: trim; strip surrounding quotes/backticks/code fences and a leading
   `Suggestion:`/`建议：` label; collapse internal whitespace/newlines to single spaces; drop a trailing
   period; reject empty, `NONE`/`NONE.`/`无`/`N/A`, text equal to the latest user message, or text longer
   than `config.maxSuggestionChars` (default 96) **after** truncation? No — reject if longer than
   2 × limit, truncate at a word/character boundary to the limit otherwise.
7. Semantic redundancy check: when the latest turn has at least one successful tool step and
   `config.semanticCheck !== false`, call the same model a second time with only the successful step
   summaries, the latest assistant response, and the candidate. `VERIFIER_SYSTEM_PROMPT` asks for exactly
   `OK` or `REDUNDANT`; `REDUNDANT` returns `{ok:true,suggestion:null,reason:'already-done'}`. This is a
   model judgment over all completed steps, not a fixed commit/push category. On verifier timeout/error or
   an unparseable answer, fall back to `isCompletedActionSuggestion` (a narrow commit/push backstop) rather
   than hiding a possibly useful suggestion. `semanticCheck:false` uses only that backstop.
8. Cache: `${sessionId}\u0000${upToSeq}` keyed result, max `config.cacheMaxEntries` (default 32, LRU-ish
   Map), TTL `config.cacheTtlMs` (default 10 min). Cache negative results too, but with a 60 s TTL.
   Coalesce concurrent identical keys into one in-flight LLM call. Never cache across restart.
9. `config.enabled === false` → 200 `{ok:true,suggestion:null,reason:'disabled'}`.

Defaults object (no Schemastery/imports; plain object merged over these):

```js
{ enabled: true, provider: '', model: '', maxSuggestionChars: 96, contextMessages: 10,
  maxToolEntries: 6, messageTextLimit: 480, maxPromptChars: 8000, maxTokens: 256, temperature: null,
  timeoutMs: 20000, cacheTtlMs: 600000, cacheMaxEntries: 32, reasoningEffort: '',
  semanticCheck: true }
```

### Prompt (English system prompt, suggestion output language = conversation language)

System prompt must state: predict the user's single next message in an ongoing coding-agent
conversation; output one short imperative message the USER would send; 2–16 words (or the equivalent
in the conversation language); no quotes/markdown/labels; grounded in the latest state and tool status
(e.g. verify the result, fix a remaining failure, inspect the diff, clean up; avoid generic
"commit and push" and never repeat an action that already succeeded); do not speak as the assistant and
do not repeat the previous user message; output exactly `NONE` when nothing is likely. The user message
contains the bounded transcript, session title, cwd, a `Steps already completed successfully in the
latest turn` list when applicable, and a final line `Predict the user's next message.`

## Client half — `client.js`

Plain browser module, no imports, no build step. Exact shape:

```js
window.__ModuleLoader__.load({
  id: 'dsh-prompt-suggest',
  factory(require) {
    const React = require('react');
    // optional React hooks via React.useState etc.; JSX not available -> React.createElement
    return { inject: ['slots', 'locale'], apply(ctx) { /* ... */ } };
  },
});
```

- Register dictionaries with `ctx.effect(() => ctx.locale.register('prompt-suggest', dicts), label)`.
  Provide all 8 keys (`zh,en,ja,es,fr,de,ru,pt`); English copy for non-zh locales is acceptable,
  zh must be real Chinese. Strings needed: `hint` ("Tab to use" / "按 Tab 使用"), `accept` (button
  aria-label "Use suggested prompt"), `dismiss` ("Hide suggestion"), `suggestion` (group aria-label).
- Register one entry in the full-width dock **above** the composer card:
  `ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'prompt-suggest', order: 30, locale: 'prompt-suggest' }, SuggestionBar))`.
  That slot is "Full-width entries above the composer card" (session scope). Existing occupants:
  todo (0), goal (10), queue (20); order 30 keeps the hint closest to the composer.
- Slot props available (verified live): `sessionId`, `useSession` (`SessionSnapshotSelector`),
  `useSessionStatus`, `useInput` (`SnapshotSelectorHook<InputState>`), `inputActions`, `t`, `useConversation`.
  `InputState` = `{ draft: string, attachmentIds: string[], draftRev: number, phase: 'plain'|'claimed'|... }`.
  `InputActions` = `{ setDraft(text), insertText(text, span), captureInsertion(), submit(), ... }`.
  `SessionSnapshot` = `{ running, blank, awaitingFirstTurn, promptAttempted, ... }`.
- Visibility: suggestion exists AND not dismissed for its `upToSeq` AND
  `useSession(s => !s.running && !s.blank && !s.awaitingFirstTurn)` (idle, has history) AND
  `useInput(s => s.phase === 'plain' && s.draft.trim() === '' && s.attachmentIds.length === 0)`
  (composer empty). Re-show after the user clears a draft; hide while typing; never show while running.
- Fetch: when eligible turns true, debounce ~250 ms, then
  `fetch('api/prompt.suggest', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ sessionId }), signal })`
  (browser-relative, same origin; the shipped session-log-export package uses the same pattern).
  Cancel on cleanup/session change; ignore stale responses (generation counter + AbortController).
  200 `{ok:true,suggestion:{text,upToSeq}}` → store suggestion; `suggestion:null` → clear; any
  network/HTTP/parse failure → silently hide (never surface an error, never throw).
  Cache is host-side, so a refetch after typing/clearing is cheap.
- Tab accepts: a document-level `keydown` listener in **capture** phase, installed with
  `ctx.effect` and removed on dispose. Act only when ALL hold: `event.key === 'Tab'`,
  no `shift/ctrl/alt/meta`, `!event.repeat`, `!event.isComposing`,
  `event.target instanceof Element && event.target.closest('[data-composer-input]') !== null`,
  and the current suggestion is visible. Then `event.preventDefault()`,
  `event.stopPropagation()`, `inputActions.setDraft(text)`, hide the bar, and do NOT submit.
  All other Tab presses must pass through untouched (focus traversal/menu completion).
  Keep the deciding state in refs updated on render so the listener reads fresh values.
- Pointer acceptance: clicking the bar's main button also accepts (`onMouseDown` preventDefault to
  keep editor focus, then `setDraft`). Dismiss button (small ✕) hides the bar for the current
  `upToSeq`; it stays a normal tab stop reachable with Shift+Tab, while the accept button is
  `tabIndex: -1` so plain Tab has exactly the one accept meaning. The accept button's `title` shows the
  full suggestion when the row is ellipsized.
- Layout/style: theme tokens only (`--dsw-alias-*`, `--dsw-radius-*`, `--dsw-specific-menu`,
  `--dsw-menu-backdrop-filter`, `--dsh-composer-*`), no literal colors. Full-width bar aligned with the
  composer: `width: calc(100% - 2*var(--dsh-composer-side-clearance) - 2*var(--dsh-composer-dock-inset));
  max-width: calc(var(--dsh-composer-card-max-width) - 2*var(--dsh-composer-dock-inset)); margin: 0 auto;` compact single line (~30 px), text ellipsis,
  a 14 px sparkle glyph, a `Tab` keycap, hover background `--dsw-alias-interactive-bg-hover`, focus ring
  token for the accept button. Insert CSS through a `<style data-plugin-css=...>` effect (cleanup on
  dispose) or a per-render `<style>` React element; never touch `document.body` or other plugins' DOM.
- Never crash the slot: wrap fetch/JSON handling, guard missing props, and render `null` when hidden.

## Response contract shared by both halves

`{ok:true, suggestion:{ text: string (1..maxSuggestionChars), upToSeq: number }, provider?, model?}`
or `{ok:true, suggestion:null, reason?: string}`. The client must tolerate extra fields and both shapes.

## Acceptance checks

- `node --check index.js`, `node --check client.js`, `node --test test/host.test.mjs` pass.
- Host unit tests cover: config normalization, completed-turn detection, transcript bounding/truncation,
  prompt content, sanitize (quotes/NONE/too-long/equal-to-last-user), model resolution fallback chain,
  cache hit/coalescing (fake llm call count), 400/404 responses, disabled config, and a stubbed
  `llm.stream` returning text-delta + finish chunks.
- Client: syntax check; slot registration verified after installation with the Client inspector;
  no imports outside `react`; every displayed string localized; no `console.error` on the happy path.
- Cross-check the UX against Codex: one prediction, Tab inserts (no send), may be absent, dismissible,
  never blocks typing, no spinner/noise while it is unavailable.

---

# Addendum — learning from accept/dismiss (v1.1, revised)

Goal: record the user's **accept (Tab / click)** and **dismiss (✕)** actions, persist them on the Host,
and condition later suggestions on them (prompt-level personalization; no model weights change).

Persistence decision: the Host owns a small durable record through `ctx.storageDomain`
(`json` backend, `~/.dsh/storages`), so learning survives page reloads, port changes, app restarts and
every Client. **No localStorage, no client-supplied learning payload.** The Host half stays
dependency-free: the storage domain spec is a plain object whose schema is a duck-typed
`{ parse(value) { … } }` (the domain facility only calls `schema.parse` on load).

## Host half (`index.js`)

### Learning store

- New exported factory `createLearningStore({ openDomain, now })`, where `openDomain` returns the
  `storageDomain` service (`ctx.get('storageDomain')`) or `undefined`.
  - Lazily opens the domain on first read/update:
    `{ name: 'prompt_suggest_learning', version: 1, layout: 'single', tables: {},
       global: { schema: { parse(value) { return isRecord(value) ? value : record(); } }, initial: record() } }`.
    `record()` = `{ version: 1, updatedAt: 0, counts: { shown: 0, accepted: 0, dismissed: 0 },
      accepted: [], dismissed: [], seenKeys: [] }` (examples are `{ text, at }`).
  - `read()` → `Promise<record>` (normalized/sanitized; memory fallback when the service is absent or
    `open` fails). `update(mutator)` → serialized through one promise chain (read latest, mutate, clamp,
    `domain.global.set(next)`, update memory). All failures degrade to the in-memory copy — never throw.
  - `close()` → closes the domain handle if opened; the plugin's own `ctx.effect` calls it.
- Caps: `MAX_STORED_EXAMPLES = 12` per list, `MAX_STORED_TEXT = 200`, `MAX_SEEN_KEYS = 50`.
  Dedupe accepted/dismissed case-insensitively (newest first). `seenKeys` dedupes `shown` events.
- `normalizeLearningRecord(raw, config)` (exported): validates/clamps a stored record (counts
  non-negative ints, string-only texts collapsed/cleaned/truncated, empty dropped, dedupe, caps) and
  returns a safe record. `learningEnabled === false` → suggestions ignore the record and feedback writes
  are ignored (store stays as-is but unused).
- Config additions (plain-object defaults, clamp): `learningEnabled: true`,
  `maxLearningExamples: 8` (0..20), `maxLearningChars: 160` (16..400).

### Feedback route

`POST /api/prompt.suggest.feedback` (exported `PROMPT_SUGGEST_FEEDBACK_PATH`), registered with
`ctx.connection.fetch.register` exactly like the suggestion route, JSON only, no-store.
Body: `{ "sessionId": string, "upToSeq": number, "action": "shown"|"accept"|"dismiss"|"reset", "text"?: string }`.
- `shown`: record key `${sessionId}:${upToSeq}`; if already in `seenKeys` ignore; else
  `counts.shown += 1` and prepend the key (cap). `text` not required.
- `accept`: `counts.accepted += 1`, prepend `{text, at}` to `accepted` (dedupe/caps). `text` required.
- `dismiss`: `counts.dismissed += 1`, prepend to `dismissed`. `text` required.
- `reset`: replace the record with `record()` (clears counts/lists/seenKeys).
- Validation: strings/small ints/action enum; `text` trimmed, control chars stripped, ≤ 512; invalid → 400
  `{ok:false,error:'invalid-request'}`; unknown session is irrelevant (no Session read); success →
  `{ok:true,counts:{shown,accepted,dismissed}}`. Body size guard uses the same 16 KiB bound.
- No conversation text is stored — only suggestion text, bounded.

### Suggestion path

- Read the learning record via the store (await), pass it to `generateSuggestion` / `buildPrompt`.
- `buildPrompt({transcript,title,cwd,learning})`: when the record has examples or counts, append
  `LEARNING_SYSTEM_PROMPT` (exported) to the system prompt and a bounded
  `User preference profile:` section after the transcript and before the final predict line:
  acceptance line (`{accepted} accepted / {shown} shown ({pct}%)`), accepted rows
  (`- text`) and dismissed rows, under the documented headers. No learning = byte-identical to today.
- `isDismissedSuggestion(candidate, learning)` (exported): normalized comparison (lowercase, collapse
  whitespace, strip leading/trailing `[.。!！?？~～]`); equal → true; or one contains the other with the
  shorter at least 8 chars and ratio ≥ 0.8 → true. Applied after `sanitizeSuggestion` →
  `nullResult('dismissed')`.
- Invalid/absent storage never fails the request (degrade to no learning).
- Tests: fake domain `{ global: { get, set } }`; cover shown dedupe, accept/dismiss recording, reset,
  validation 400s, persistence across two store instances sharing one fake domain global, prompt rows,
  dismissed filter, learningEnabled off, storage-absent fallback, and the existing 41 staying green.

## Client half (`client.js`)

- Remove the localStorage learning record and the learning request payload. The suggestion POST body
  stays `{ sessionId }`.
- After the suggestion becomes visible, send `shown` once per `${sessionId}:${upToSeq}` (tracked in a ref;
  the Host also dedupes). On accept send `accept` with the suggestion text; on dismiss send `dismiss`
  with the text; all fire-and-forget and silent on failure.
- Shift+click on ✕: send `{action:'reset'}` (clears the Host record), hide the bar for the current
  `upToSeq`, and keep the hint discoverable via the dismiss button `title` (new `dismissReset` locale key,
  all 8 locales, real Chinese; keep `dismiss`).
- Feedback request: `POST api/prompt.suggest.feedback`, JSON, `keepalive: true` when supported, wrapped in
  try/catch; it must never block or throw into render/handlers. No extra visible UI.
- Keep Tab accept (`setDraft` exactly once, never submit), visibility guards, and all existing
  lifecycle/cleanup behavior unchanged. Verify with `node --check` plus a /tmp harness executing the real
  client.js with fake React/DOM/fetch: feedback calls on show/accept/dismiss/reset with correct bodies and
  no duplicates for the same turn; no feedback while hidden/ineligible; Tab still works; failures silent.

## Packaging and documentation

README: new "学习机制" section (what is stored where: `~/.dsh/storages` domain `prompt_suggest_learning`;
counts/examples/seen keys only, no conversation text; how it conditions suggestions; Shift+click ✕ 清空
学习记录; `learningEnabled` config; survives restart; per-profile not per-device/port). Config table gains
the three fields. CONTRACT acceptance checks updated.

---

# Addendum v1.2 — "学习数据" sidebar page

Goal: a global sidebar entry named **学习数据** (localized) that opens a main panel showing the stored
learning record: acceptance rate, counts, and the recent accepted/dismissed suggestion texts.

## Extension points (verified live)

- `main` slot: keyed, root scope, registration `{ name: 'main', key: PANEL_ID, locale: NS }`
  (component receives the standard main props; a page registered here is selected by
  `ctx.layout.selectPanel(PANEL_ID)` and validated against `main` entries).
- `sidebar.panellist` slot: list, root scope, registration
  `{ name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => t('panel.label'), locale: NS }`
  where the occupant is the small icon component (ownerProps `{ size, active }`, color `currentColor`).
  The id must equal the `main` key; the sidebar owns the button/label/selection.
- Existing ids: plugins (0), schedules (10) → use order 20. `PANEL_ID = 'prompt-suggest-learning'`.
- Locale: registration supports `locale: NS`; the plugin manager page pattern uses a `label` thunk and
  a bound `t` from `ctx.locale.bind(NS)`. Subscribe to `ctx.locale.subscribe` for in-page labels if
  needed; use theme tokens only (`--dsw-alias-*`, `--dsw-radius-*`, `--dsw-font-*`).
- Page/chrome comparison reference: the Plugin Manager page (`packages/client/ui-plugin-manager` in the
  installed build) — title 20px/500, intro 13px secondary, content column max-width ~760–960px,
  top inset clamp(24px,4vw,48px), scrollable content.

## Host half (`index.js`)

1. New exported constant `PROMPT_SUGGEST_LEARNING_PATH = '/api/prompt.suggest.learning'`.
2. New route, registered with `ctx.connection.fetch.register` like the others:
   `{ path, methods: ['GET'], requestBody: 'buffered', fetch: handler }`.
   `createLearningDataHandler({ config, store })` (exported) → `GET` only (other methods 405 JSON):
   read the store (fail-soft; missing storage → empty record), normalize, respond
   `{ ok: true, counts: { shown, accepted, dismissed }, accepted: [{text, at}], dismissed: [{text, at}], updatedAt }`
   with `cache-control: no-store`. Never include conversation text or storage errors' detail.
   Reading is allowed regardless of `learningEnabled` (users can still inspect/clear data).
3. Feedback route validation relaxation: for `action === 'reset'`, `sessionId` and `upToSeq` become
   optional (the panel clears without a Session); validate them only for shown/accept/dismiss.
   Keep accept/dismiss `text` required and bounded as today.
4. Tests: GET route returns normalized record incl. examples; empty store → zeros/empty lists;
   non-GET → 405; storage absent still 200; reset without sessionId clears; existing 63 stay green.

## Client half (`client.js`)

1. Constants: `PANEL_ID = 'prompt-suggest-learning'`, `LEARNING_ROUTE = 'api/prompt.suggest.learning'`.
2. Register both slots via `ctx.slots.inject(...)`:
   - `main` keyed entry with `locale: NS` rendering `LearningPage`;
   - `sidebar.panellist` list entry `{ id: PANEL_ID, order: 20, label: () => t('panel.label'), locale: NS }`
     rendering `LearningPanelIcon({ size, active })` (16px in expanded, 18px in rail; `currentColor`;
     simple chart/sparkle glyph; `aria-hidden`).
3. `LearningPage` (root scope, no Session needed): no hooks outside the component; defensive fetch:
   - On mount and whenever `ctx.layout.panelInfo.getSnapshot().activePanelId === PANEL_ID` becomes true
     (subscribe + unsubscribe), plus a manual Refresh button, `GET api/prompt.suggest.learning`
     (same-origin, JSON). Show loading / error-with-retry (localized) / empty states; never throw.
   - Render: page title 学习数据 + intro explaining the record lives locally in the profile
     (`~/.dsh/storages/prompt_suggest_learning.json`) and conditions later suggestions;
     stats row: 采纳率 (`accepted/shown`, shown=0 → `—`), 展示次数, 采纳次数, 忽略次数;
     two sections 最近采纳 / 最近忽略 with up to 12 rows each (text ellipsized/2-line, relative time);
     empty state when nothing recorded.
   - Toolbar: Refresh icon button; "清空学习记录" as a two-step confirm button (first click → localized
     "确认清空？", second click POSTs `api/prompt.suggest.feedback` `{action:'reset'}` then refetches;
     auto-cancel after ~4s). Disabled while working; surface failure inline; never throw.
4. Locale: add keys under the existing NS dictionaries for all 8 locales (real Chinese), covering the
   panel label, page title/intro, stat labels, section titles, empty/loading/error, refresh, clear +
   confirm states, and relative-time units; keep existing keys.
5. Re-render on locale change via `ctx.locale.subscribe` in a tiny hook; theme tokens only; no host
   package imports; no document.body; cleanup subscriptions on unmount.
6. Harness: adapt the /tmp client harness to also fake two more slots: assert both registrations exist
   with correct options, page fetch on activation, stats/rate rendering, empty/error states, refresh,
   two-step clear POSTs reset and refetches, locale switch re-render. Keep the existing feedback/Tab
   scenarios green. Do not leave files in the package.

## Packaging and verification

Reload the plugin, verify both slots live (`Slots.listSubTree` roots `main` and `sidebar.panellist`),
screenshot the page in the real GUI, update README/CONTRACT acceptance notes, and report.
