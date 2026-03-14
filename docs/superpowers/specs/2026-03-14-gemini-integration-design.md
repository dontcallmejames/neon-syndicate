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
| NL parsing timing | Batch during tick cycle (step 3.5), not at submission time |
| Failure behavior | Graceful degrade — game never stalls on Gemini errors |
| Fallback narrative | Template-generated from briefing payload — never null |
| Fallback headline | Single generic line — never empty |
| Test strategy | Mock `@google/generative-ai` — no real API key required for tests |

---

## 1. The `src/game/gemini.js` Module

One file, initialized once with `process.env.GEMINI_API_KEY` and `process.env.GEMINI_MODEL` (default: `gemini-2.0-flash`). Uses the `@google/generative-ai` npm package.

If `GEMINI_API_KEY` is absent or empty, each function logs a warning and returns a safe no-op result:
- `parseNLAction` → `null` (action treated as unsubmitted)
- `generateNarratives` → `{}` (all corps get fallback narrative)
- `generateHeadlines` → `[]` (generic fallback headline used)

This allows the game to run in development without a Gemini API key.

**Exports:**
```js
parseNLAction(rawResponse, availableActions, corp)  → Promise<parsedActions | null>
generateNarratives(briefingPayloads)                → Promise<{ [corpId]: string }>
generateHeadlines(events, tick)                     → Promise<string[]>
buildFallbackNarrative(corp, payload)               → string  // synchronous, no Gemini
```

`buildFallbackNarrative` is exported for use in tests and anywhere a guaranteed non-null narrative is needed.

---

## 2. NL Action Parsing

### When it runs

In `runTick` (`src/game/tick.js`), between `generateResources` (step 2) and `resolveActions` (step 3). Specifically:

1. Fetch all `pending_actions` rows for the current tick where `raw_response IS NOT NULL AND parsed_actions IS NULL AND status = 'pending'`
2. For each row, call `parseNLAction` with the raw text, the available actions list, and the corp's current state
3. On success: write the returned JSON to `parsed_actions` in the DB
4. On failure: set `status = 'rejected'` — same outcome as a malformed structured submission

### The prompt

The prompt gives Gemini:
- The full available actions schema (types, costs, required fields)
- The corp's current resource balances (so Gemini doesn't hallucinate impossible actions)
- The raw natural language string from the agent

Expected output: `{ primaryAction: { type, ...fields }, freeActions: [...] }` matching the structure `resolveActions` expects. Gemini is instructed to return only valid JSON with no markdown wrapping.

### Failure modes

| Failure | Behavior |
|---|---|
| Gemini API error / timeout | `status = 'rejected'`, corp skips this tick's action |
| Gemini returns malformed JSON | Same — `status = 'rejected'` |
| `GEMINI_API_KEY` absent | Same — `status = 'rejected'` (with warning log) |

No retries. The tick cannot stall waiting for Gemini.

---

## 3. Narrative Briefings

### When it runs

In `runTick`, after all corps' briefing payloads are built (the `buildBriefingPayload` loop) but before the `INSERT OR REPLACE` transaction stores them.

### The call

One Gemini call for all corps — `generateNarratives(briefingPayloads)` receives an array of payloads. The prompt instructs Gemini to return a JSON object:

```json
{
  "<corpId>": "2-3 sentences of cyberpunk prose for this corp's tick",
  "<corpId>": "..."
}
```

The prompt instructs Gemini to write from the corp's perspective, reference specific events (district changes, messages received, laws enacted), and maintain a cyberpunk tabloid tone — dramatic, terse, present tense.

tick.js merges the returned narratives into each payload before storage:
```js
payload.narrative = narratives[corp.id] || buildFallbackNarrative(corp, payload);
```

### Fallback narrative

`buildFallbackNarrative(corp, payload)` generates a plain-text summary from structured data:

```
Tick {N}. {CorpName} controls {X} district(s). Credits: {C} | Energy: {E} | Reputation: {label}. {eventSummary}
```

Where `eventSummary` is either "No significant events this cycle." or a count of events from `payload.events`. Always a non-empty string. No Gemini required.

### Failure modes

| Failure | Behavior |
|---|---|
| Gemini API error / timeout | All corps receive fallback narrative |
| Gemini returns malformed JSON | All corps receive fallback narrative |
| Gemini omits a corp from the response | That corp receives fallback narrative |

---

## 4. Headline Generation

### When it runs

In `runTick`, after briefings are stored and before `is_ticking` is cleared. This is the last Gemini call of the tick.

### The call

`generateHeadlines(events, tick)` receives the events written during this tick (from the `events` table where `tick = newTick`). The prompt instructs Gemini to write 3–5 cyberpunk tabloid headlines based on those events — naming districts and corps involved but not revealing resource amounts or mechanic details (e.g., energy spent).

The returned array of strings is stored as a single event row:
```js
writeEvent(db, {
  seasonId,
  tick: newTick,
  type: 'headline',
  narrative: headlines.join('\n'),
});
```

`briefing.js` already queries `events WHERE type = 'headline' AND tick = ?` — no schema changes needed.

### Fallback headline

If Gemini fails, a single fallback string is stored:
```
CITY GRID STABLE — NO MAJOR INCIDENTS REPORTED THIS CYCLE
```

Always non-empty.

---

## 5. Tick Cycle Integration

Updated `runTick` order:

```
1.  Increment tick; set is_ticking = 1
2.  generateResources(conn, seasonId, newTick)
3.  [NEW] Parse NL submissions: fetch raw_response rows, call parseNLAction per row, write parsed_actions
4.  resolveActions(conn, seasonId, newTick - 1)
5.  Build briefing payloads for all corps (buildBriefingPayload loop)
6.  [NEW] generateNarratives(payloads) → merge narratives into payloads
7.  INSERT OR REPLACE briefings into DB
8.  [NEW] generateHeadlines(events, newTick) → writeEvent(type='headline')
9.  Clear is_ticking = 0
```

Steps 6 and 8 are the only async additions. The tick loop must be made `async` to `await` these calls.

---

## 6. Configuration

New environment variables added to `.env.example`:

```
GEMINI_API_KEY=           # required for Gemini features; game runs without it (degraded)
GEMINI_MODEL=gemini-2.0-flash  # optional override
```

---

## 7. Files Changed

| File | Change |
|---|---|
| `src/game/gemini.js` | **Create** — three exported functions + fallback helpers |
| `src/game/tick.js` | **Modify** — make `runTick` async; add NL parsing step; add narrative merge; add headline step |
| `package.json` | **Modify** — add `@google/generative-ai` dependency |
| `.env.example` | **Modify** — add `GEMINI_API_KEY` and `GEMINI_MODEL` |
| `tests/game/gemini.test.js` | **Create** — unit tests with mocked Gemini client |
| `tests/game/tick.test.js` | **Modify** — add NL parsing and headline integration tests |

---

## 8. Testing Strategy

`@google/generative-ai` is mocked at the module level using Jest's `jest.mock()`. Tests do not require a real API key.

**`tests/game/gemini.test.js` covers:**
- `parseNLAction`: mock returns valid JSON → verify returned structure; mock returns garbage → verify null; mock throws → verify null
- `generateNarratives`: mock returns valid keyed object → verify merge; mock throws → verify all corps get fallback
- `generateHeadlines`: mock returns array → verify returned; mock throws → verify fallback string returned
- `buildFallbackNarrative`: no mock needed — pure function; verify output contains corp name, tick, resource summary

**`tests/game/tick.test.js` additions:**
- Submit a `raw_response` NL action, run `runTick`, verify `parsed_actions` was written and the action resolved correctly
- Verify a `headline` event row exists after `runTick`
- Verify briefing payload `narrative` is non-null after `runTick`

---

## Out of Scope

- Streaming Gemini responses
- Per-agent narrative tone customization
- Caching Gemini responses across ticks
- Gemini for action validation (validation stays in `validate.js`)
