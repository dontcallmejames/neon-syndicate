# Neon Syndicate — Plan 3: Gemini Integration Design Spec
**Date:** 2026-03-14
**Status:** Approved

---

## Overview

Integrate Google Gemini into the Neon Syndicate tick loop for three purposes: parsing natural language action submissions from agents, generating per-corp narrative briefings, and generating cyberpunk tabloid headlines from each tick's event log.

---

## Core Design Decisions

| Dimension | Decision |
|---|---|
| Model | `gemini-2.0-flash` (configurable via `GEMINI_MODEL` env var) |
| Code structure | Single `src/game/gemini.js` module, three exported functions |
| NL parsing timing | Batch during tick cycle (step 3), not at submission time |
| Failure behavior | Graceful degrade — game never stalls on Gemini errors |
| Fallback narrative | Template-generated from briefing payload — never null |
| Fallback headline | Single generic line — never empty |
| Test strategy | Mock `@google/generative-ai` — no real API key required for tests |

---

## 1. The `src/game/gemini.js` Module

One file, initialized with `process.env.GEMINI_API_KEY` and `process.env.GEMINI_MODEL` (default: `gemini-2.0-flash`). Uses the `@google/generative-ai` npm package.

If `GEMINI_API_KEY` is absent or empty at module load time, each async function logs a warning and returns a safe no-op result:
- `parseNLAction` → `null`
- `generateNarratives` → `{}`
- `generateHeadlines` → `[]`

The `tick.js` integration layer is responsible for translating these no-op returns into the appropriate DB writes (e.g., `status = 'rejected'` for null parse results). `parseNLAction` never writes to the database itself — it is a pure async function that returns structured data or null.

**Exports:**
```js
parseNLAction(rawResponse, availableActions, corp)         → Promise<parsedActions | null>
generateNarratives(corpPayloadPairs)                       → Promise<{ [corpId]: string }>
generateHeadlines(events, tick)                            → Promise<string[]>
buildFallbackNarrative(corp, payload)                      → string  // synchronous, no Gemini
```

Where `corpPayloadPairs` is `Array<{ corp, payload }>` — each entry carries the full corporation row and its briefing payload together so corps can be keyed by `corp.id` in the response map.

`buildFallbackNarrative` is exported for use in `tick.js`, `briefing.js`, and tests.

---

## 2. NL Action Parsing

### When it runs

In `runTick` (`src/game/tick.js`), between `generateResources` (step 2) and `resolveActions` (step 4). Specifically, it processes actions for `tick = newTick - 1` — the same tick that `resolveActions(conn, seasonId, newTick - 1)` will resolve. Actions are submitted by agents during tick N and resolved when `runTick` fires for tick N+1, so the fetch predicate is:

```sql
SELECT pa.*, c.reputation FROM pending_actions pa
JOIN corporations c ON c.id = pa.corp_id
WHERE pa.tick = ? AND pa.raw_response IS NOT NULL
  AND pa.parsed_actions IS NULL AND pa.status = 'pending'
```

bound to `newTick - 1`.

### Available actions list

The `availableActions` argument passed to `parseNLAction` is built by calling `buildAvailableActions(isPariah)` (imported from `src/api/routes/briefing.js`, which must export it). `isPariah` is `corp.reputation < 15`. This ensures Gemini only knows about actions the corp can actually submit.

### The prompt

The prompt provides Gemini with:
- The corp's current resource balances
- The full available actions list (types, costs, required fields)
- The raw natural language string from the agent

Gemini is instructed to return only valid JSON — no markdown, no explanation — matching:
```json
{ "primaryAction": { "type": "...", ...fields }, "freeActions": [...] }
```

### Failure modes

| Failure | `parseNLAction` return | `tick.js` DB write |
|---|---|---|
| Gemini API error / timeout | `null` | `status = 'rejected'` |
| Gemini returns non-JSON | `null` | `status = 'rejected'` |
| `GEMINI_API_KEY` absent | `null` (+ warning log) | `status = 'rejected'` |
| Success | `{ primaryAction, freeActions }` | `parsed_actions = JSON.stringify(result)` |

No retries. The tick cannot stall waiting for Gemini.

---

## 3. Narrative Briefings

### When it runs

In `runTick`, after all corps' briefing payloads are built (the `buildBriefingPayload` loop) but before the `INSERT OR REPLACE` transaction stores them.

### The call

One Gemini call for all corps — `generateNarratives(corpPayloadPairs)` receives an array of `{ corp, payload }` objects. The prompt instructs Gemini to return a JSON object keyed by `corp.id`:

```json
{
  "<corpId>": "2-3 sentences of cyberpunk prose for this corp's tick",
  "<corpId>": "..."
}
```

The prompt instructs Gemini to write from the corp's perspective, reference specific events (district changes, messages received, laws enacted), and maintain a cyberpunk tabloid tone — dramatic, terse, present tense.

The response JSON is parsed per-corp key individually. If the overall response is valid JSON, each corp gets its value or falls back independently:

```js
payload.narrative = narratives[corp.id] ?? buildFallbackNarrative(corp, payload);
```

### Failure modes

| Failure | Behavior |
|---|---|
| Gemini API error / timeout | All corps receive `buildFallbackNarrative` |
| Gemini returns non-JSON | All corps receive `buildFallbackNarrative` |
| Gemini omits a specific corp's key | That corp receives `buildFallbackNarrative`; others use their Gemini narrative |

### Fallback narrative

`buildFallbackNarrative(corp, payload)` generates a plain-text summary from structured data:

```
Tick {N}. {CorpName} controls {X} district(s). Credits: {C} | Energy: {E} | Reputation: {label}. {eventSummary}
```

Where `eventSummary` is either `"No significant events this cycle."` or `"{N} events recorded."` based on `payload.events.length`. Always a non-empty string. No Gemini required.

---

## 4. Headline Generation

### When it runs

In `runTick`, after briefings are stored and before `is_ticking` is cleared. Events are queried from the `events` table where `tick = newTick - 1` — matching what `resolveActions(conn, seasonId, newTick - 1)` writes. (Events are tagged with the tick they were resolved for, which is `newTick - 1`.)

### The call

`generateHeadlines(events, tick)` receives the events array. The prompt instructs Gemini to write 3–5 cyberpunk tabloid headlines based on those events — naming districts and corps involved but not revealing resource amounts or mechanic details. If no events occurred, the prompt requests generic city-news headlines.

The returned array of strings is stored via `writeEvent`:
```js
writeEvent(db, {
  seasonId,
  tick: newTick,
  type: 'headline',
  narrative: headlines.join('\n'),
});
```

Note: the headline event is tagged with `tick = newTick` (the current tick), not `newTick - 1`. This matches the existing briefing query: `events WHERE type = 'headline' AND tick = ?` bound to `currentTick`. No schema changes needed.

### Fallback headline

If Gemini fails or returns an empty array:
```
CITY GRID STABLE — NO MAJOR INCIDENTS REPORTED THIS CYCLE
```

Stored as a one-element array: `['CITY GRID STABLE — NO MAJOR INCIDENTS REPORTED THIS CYCLE']`.

---

## 5. Tick Cycle Integration

`runTick` is made `async`. To prevent overlapping ticks when a Gemini call takes longer than the 5-second poll interval, the `setInterval` callback in `startTickLoop` is converted to an `async` function that `await`s `runTick`. The existing `is_ticking` flag provides a secondary guard — if `runTick` is somehow called while a tick is in progress, the `is_ticking = 1` check at the top of `runTick` prevents double-execution.

Updated `runTick` order:

```
1.  Increment tick; set is_ticking = 1
2.  generateResources(conn, seasonId, newTick)
3.  [NEW] Parse NL submissions: fetch raw_response rows for tick = newTick - 1,
          call parseNLAction per row, write parsed_actions or status = 'rejected'
4.  resolveActions(conn, seasonId, newTick - 1)
5.  Build briefing payloads for all corps (buildBriefingPayload loop)
6.  [NEW] generateNarratives(corpPayloadPairs) → merge narratives into payloads
          (fallback via buildFallbackNarrative for any missing corp or on error)
7.  INSERT OR REPLACE briefings into DB
8.  [NEW] generateHeadlines(events for newTick - 1, newTick)
          → writeEvent(type='headline', tick=newTick)
9.  Clear is_ticking = 0
```

---

## 6. Live Briefing Path (`src/api/routes/briefing.js`)

The live briefing path (used when no stored briefing matches the current tick) currently sets `narrative: null`. In Plan 3, this is updated to call `buildFallbackNarrative(corp, payload)` synchronously instead — ensuring the `narrative` field is never null in any briefing response.

`buildAvailableActions` is also extracted from `briefing.js` as a named export so `tick.js` can import it for the NL parsing step.

---

## 7. Configuration

New environment variables added to `.env.example`:

```
GEMINI_API_KEY=                    # required for Gemini features; game runs without it (degraded)
GEMINI_MODEL=gemini-2.0-flash      # optional override
```

---

## 8. Files Changed

| File | Change |
|---|---|
| `src/game/gemini.js` | **Create** — three exported async functions + `buildFallbackNarrative` |
| `src/game/tick.js` | **Modify** — make `runTick` async; update `startTickLoop` to await; add NL parsing step; add narrative merge; add headline step |
| `src/api/routes/briefing.js` | **Modify** — export `buildAvailableActions`; call `buildFallbackNarrative` in live path instead of `null` |
| `package.json` | **Modify** — add `@google/generative-ai` dependency |
| `.env.example` | **Modify** — add `GEMINI_API_KEY` and `GEMINI_MODEL` |
| `tests/game/gemini.test.js` | **Create** — unit tests with mocked Gemini client |
| `tests/game/tick.test.js` | **Modify** — add NL parsing and headline integration tests |

---

## 9. Testing Strategy

`@google/generative-ai` is mocked at the module level using Jest's `jest.mock()`. Tests do not require a real API key.

**`tests/game/gemini.test.js` covers:**
- `parseNLAction`: mock returns valid JSON → verify returned structure; mock returns non-JSON → verify null; mock throws → verify null
- `parseNLAction` with no API key: unset `process.env.GEMINI_API_KEY` before requiring module → verify null returned and warning logged
- `generateNarratives`: mock returns valid keyed object → verify returned map; mock returns partial object (one corp missing) → verify missing corp gets fallback, others get Gemini value; mock throws → verify all corps get fallback
- `generateHeadlines`: mock returns array → verify returned; mock throws → verify fallback string in returned array
- `buildFallbackNarrative`: no mock needed — pure function; verify output contains corp name, tick number, resource summary, and is non-empty for any valid payload

**`tests/game/tick.test.js` additions:**
- Submit a `raw_response` NL action (with `parsed_actions = null`), mock `parseNLAction` to return a valid claim action, run `runTick`, verify `parsed_actions` was written and the action resolved (district ownership changed)
- Submit a `raw_response`, mock `parseNLAction` to return `null`, run `runTick`, verify `status = 'rejected'`
- Run `runTick`, verify a `headline` event row with `tick = newTick` exists in the events table
- Run `runTick`, verify briefing payload `narrative` is a non-empty string (not null)

---

## Out of Scope

- Streaming Gemini responses
- Per-agent narrative tone customization
- Caching Gemini responses across ticks
- Gemini for action validation (validation stays in `validate.js`)
- Retry logic on Gemini failures
