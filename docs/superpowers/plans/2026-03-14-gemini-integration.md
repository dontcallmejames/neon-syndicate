# Gemini Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Gemini 2.0 Flash to the tick loop for NL action parsing, per-corp narrative briefings, and cyberpunk headline generation.

**Architecture:** A single `src/game/gemini.js` module exports four functions: `parseNLAction`, `generateNarratives`, `generateHeadlines`, and `buildFallbackNarrative`. `tick.js` is made async and calls all three Gemini functions at the appropriate steps. `briefing.js` exports `buildAvailableActions` (needed by the NL parser) and replaces its `narrative: null` stub with a synchronous fallback.

**Tech Stack:** Node.js, `@google/generative-ai` npm package, Jest (with `jest.mock` for unit tests), better-sqlite3, existing `writeEvent` helper.

---

## File Structure

| File | Role |
|---|---|
| `src/game/gemini.js` | **Create** — all Gemini logic + `buildFallbackNarrative` |
| `src/api/routes/briefing.js` | **Modify** — export `buildAvailableActions`; use `buildFallbackNarrative` in live path |
| `src/game/tick.js` | **Modify** — make `runTick` async; add NL parsing, narrative merge, headline steps; update `startTickLoop` |
| `package.json` | **Modify** — add `@google/generative-ai` |
| `.env.example` | **Modify** — add `GEMINI_API_KEY`, `GEMINI_MODEL` |
| `tests/game/gemini.test.js` | **Create** — unit tests (mocked Gemini client) |
| `tests/game/tick.test.js` | **Modify** — `await runTick`; add NL + narrative + headline tests |
| `tests/api/briefing.test.js` | **Modify** — `narrative` field assertions |

---

## Chunk 1: gemini.js + briefing.js changes

### Task 1: Install dependency + `.env.example`

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Install the Gemini SDK**

```bash
cd C:/Users/jford/OneDrive/Projects/AgentGame
npm install @google/generative-ai
```

Expected: `@google/generative-ai` appears in `package.json` dependencies.

- [ ] **Step 2: Add env vars to `.env.example`**

Open `.env.example` and append:
```
GEMINI_API_KEY=           # required for Gemini features; game runs without it (degraded)
GEMINI_MODEL=gemini-2.0-flash
```

- [ ] **Step 3: Verify existing tests still pass**

```bash
npm test
```

Expected: all tests pass (count unchanged from before this task).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "feat: add @google/generative-ai dependency"
```

---

### Task 2: `src/game/gemini.js` — skeleton + `buildFallbackNarrative`

**Files:**
- Create: `src/game/gemini.js`
- Create: `tests/game/gemini.test.js`

- [ ] **Step 1: Write the failing tests for `buildFallbackNarrative`**

Create `tests/game/gemini.test.js`:

```js
// tests/game/gemini.test.js
// jest.mock must be at the top — Jest hoists it before any require calls.
// All module imports are also hoisted here so the mock is active when they resolve.
jest.mock('@google/generative-ai');

const { GoogleGenerativeAI } = require('@google/generative-ai');
// Import all four exports at the top so the mock is already in place.
const {
  buildFallbackNarrative,
  parseNLAction,
  generateNarratives,
  generateHeadlines,
} = require('../../src/game/gemini');

describe('buildFallbackNarrative', () => {
  test('includes corp name and tick number', () => {
    const corp = { name: 'OmegaCorp' };
    const payload = {
      tick: 5,
      holdings: [{}, {}],
      resources: { credits: 22, energy: 8 },
      reputationLabel: 'Neutral',
      events: ['Something happened.'],
    };
    const result = buildFallbackNarrative(corp, payload);
    expect(result).toContain('OmegaCorp');
    expect(result).toContain('Tick 5');
    expect(result).toContain('2 district');
    expect(result.length).toBeGreaterThan(0);
  });

  test('reports event count when events exist', () => {
    const corp = { name: 'Corp' };
    const payload = {
      tick: 3,
      holdings: [{}],
      resources: { credits: 5, energy: 3 },
      reputationLabel: 'Notorious',
      events: ['e1', 'e2', 'e3'],
    };
    const result = buildFallbackNarrative(corp, payload);
    expect(result).toContain('3 event');
  });

  test('says no significant events when events array is empty', () => {
    const corp = { name: 'Corp' };
    const payload = {
      tick: 1,
      holdings: [],
      resources: { credits: 0, energy: 0 },
      reputationLabel: 'Pariah',
      events: [],
    };
    const result = buildFallbackNarrative(corp, payload);
    expect(result).toContain('No significant events');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=gemini
```

Expected: FAIL — `Cannot find module '../../src/game/gemini'`

- [ ] **Step 3: Create `src/game/gemini.js` with skeleton and `buildFallbackNarrative`**

```js
// src/game/gemini.js
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Model is instantiated per-call so GEMINI_API_KEY can be set/changed in tests
// without module-level caching issues.
function getModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' });
}

function buildFallbackNarrative(corp, payload) {
  const eventSummary = payload.events && payload.events.length > 0
    ? `${payload.events.length} event(s) recorded.`
    : 'No significant events this cycle.';
  return `Tick ${payload.tick}. ${corp.name} controls ${payload.holdings.length} district(s). Credits: ${payload.resources.credits} | Energy: ${payload.resources.energy} | Reputation: ${payload.reputationLabel}. ${eventSummary}`;
}

async function parseNLAction(rawResponse, availableActions, corp) {
  // TODO Task 3
  return null;
}

async function generateNarratives(corpPayloadPairs) {
  // TODO Task 4
  return {};
}

async function generateHeadlines(events, tick) {
  // TODO Task 5
  return [];
}

module.exports = { parseNLAction, generateNarratives, generateHeadlines, buildFallbackNarrative };
```

- [ ] **Step 4: Run tests to verify `buildFallbackNarrative` passes**

```bash
npm test -- --testPathPattern=gemini
```

Expected: 3 tests pass.

- [ ] **Step 5: Run full suite to check nothing is broken**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/game/gemini.js tests/game/gemini.test.js
git commit -m "feat: add gemini.js skeleton with buildFallbackNarrative"
```

---

### Task 3: `parseNLAction`

**Files:**
- Modify: `src/game/gemini.js`
- Modify: `tests/game/gemini.test.js`

- [ ] **Step 1: Write failing tests for `parseNLAction`**

Add to `tests/game/gemini.test.js` (after the `buildFallbackNarrative` describe block):

```js
describe('parseNLAction', () => {
  // parseNLAction is imported at the top of the file — no require here.
  let mockGenerateContent;

  beforeEach(() => {
    mockGenerateContent = jest.fn();
    GoogleGenerativeAI.mockImplementation(() => ({
      getGenerativeModel: () => ({ generateContent: mockGenerateContent }),
    }));
    process.env.GEMINI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  const fakeCorp = { name: 'TestCorp', credits: 20, energy: 10, workforce: 5, intelligence: 5, influence: 0 };

  test('returns parsed JSON on success', async () => {
    const expected = { primaryAction: { type: 'claim', targetDistrictId: 'dist-1' }, freeActions: [] };
    mockGenerateContent.mockResolvedValue({ response: { text: () => JSON.stringify(expected) } });

    const result = await parseNLAction('claim the nearest district', [], fakeCorp);
    expect(result).toEqual(expected);
  });

  test('strips markdown fences if Gemini wraps in ```json', async () => {
    const expected = { primaryAction: { type: 'fortify', targetDistrictId: 'dist-2' }, freeActions: [] };
    mockGenerateContent.mockResolvedValue({
      response: { text: () => `\`\`\`json\n${JSON.stringify(expected)}\n\`\`\`` },
    });

    const result = await parseNLAction('fortify my hub', [], fakeCorp);
    expect(result).toEqual(expected);
  });

  test('returns null when Gemini throws', async () => {
    mockGenerateContent.mockRejectedValue(new Error('network error'));
    const result = await parseNLAction('do something', [], fakeCorp);
    expect(result).toBeNull();
  });

  test('returns null when response is not valid JSON', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'sorry I cannot help' } });
    const result = await parseNLAction('do something', [], fakeCorp);
    expect(result).toBeNull();
  });

  test('returns null when response is valid JSON but missing required keys', async () => {
    // Gemini sometimes returns {"error": "..."} or {} — must be rejected
    mockGenerateContent.mockResolvedValue({ response: { text: () => '{"error": "cannot parse"}' } });
    const result = await parseNLAction('do something', [], fakeCorp);
    expect(result).toBeNull();
  });

  test('returns null when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;
    const result = await parseNLAction('claim the grid', [], fakeCorp);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npm test -- --testPathPattern=gemini
```

Expected: `parseNLAction` tests fail (stub returns null but `returns parsed JSON` fails).

- [ ] **Step 3: Implement `parseNLAction` in `src/game/gemini.js`**

Replace the `parseNLAction` stub:

```js
async function parseNLAction(rawResponse, availableActions, corp) {
  const model = getModel();
  if (!model) {
    console.warn('[gemini] GEMINI_API_KEY not set — NL parsing skipped');
    return null;
  }

  const primaryActions = availableActions.filter(
    a => !['message', 'propose_alliance', 'break_alliance', 'trade', 'embargo', 'lobby'].includes(a.type)
  );
  const freeActions = availableActions.filter(
    a => ['message', 'propose_alliance', 'break_alliance', 'trade', 'embargo', 'lobby'].includes(a.type)
  );

  const prompt = `You are parsing a game action for a corporation in a cyberpunk strategy game.
Convert the following natural language into a JSON action object.
Return ONLY valid JSON — no markdown, no explanation.

Corporation: ${corp.name}
Resources: Credits=${corp.credits}, Energy=${corp.energy}, Workforce=${corp.workforce}, Intelligence=${corp.intelligence}, Influence=${corp.influence}

Available primary actions (choose at most one):
${primaryActions.map(a => `- ${a.type}: ${a.notes}`).join('\n')}

Available free actions (include any number):
${freeActions.map(a => `- ${a.type}: ${a.notes}`).join('\n')}

Required JSON format:
{
  "primaryAction": { "type": "<action_type>", ...required fields } or null,
  "freeActions": [ { "type": "<action_type>", ...fields }, ... ]
}

Field requirements per action type:
- attack: "targetDistrictId" (string), "energySpent" (integer >= 5)
- claim / fortify / sabotage / leak_scandal / counter_intelligence: "targetDistrictId" (string)
- corporate_assassination: "targetCorpId" (string)
- message: "toCorpId" (string), "text" (string)
- trade: "withCorpId" (string), "offer": {"<resource>": amount}, "request": {"<resource>": amount}
- propose_alliance / break_alliance: "withCorpId" (string)
- lobby: "credits" (integer, multiple of 10)
- embargo: "targetCorpId" (string)

Agent response: "${rawResponse}"`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const json = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(json);
    // Validate shape — must have both primaryAction and freeActions keys
    if (typeof parsed !== 'object' || parsed === null ||
        !('primaryAction' in parsed) || !('freeActions' in parsed)) {
      console.warn('[gemini] parseNLAction: response missing required keys');
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn('[gemini] parseNLAction failed:', err.message);
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=gemini
```

Expected: all `parseNLAction` tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/game/gemini.js tests/game/gemini.test.js
git commit -m "feat: implement parseNLAction with markdown-fence stripping and null fallback"
```

---

### Task 4: `generateNarratives`

**Files:**
- Modify: `src/game/gemini.js`
- Modify: `tests/game/gemini.test.js`

- [ ] **Step 1: Write failing tests for `generateNarratives`**

Add to `tests/game/gemini.test.js`:

```js
describe('generateNarratives', () => {
  // generateNarratives is imported at the top of the file — no require here.
  let mockGenerateContent;

  const fakePairs = [
    {
      corp: { id: 'corp-1', name: 'OmegaCorp' },
      payload: { tick: 5, holdings: [{}, {}], resources: { credits: 22, energy: 8 }, reputationLabel: 'Trusted', events: ['Seized district.'], headlines: [], alliances: [] },
    },
    {
      corp: { id: 'corp-2', name: 'NovaCorp' },
      payload: { tick: 5, holdings: [{}], resources: { credits: 5, energy: 2 }, reputationLabel: 'Neutral', events: [], headlines: [], alliances: [] },
    },
  ];

  beforeEach(() => {
    mockGenerateContent = jest.fn();
    GoogleGenerativeAI.mockImplementation(() => ({
      getGenerativeModel: () => ({ generateContent: mockGenerateContent }),
    }));
    process.env.GEMINI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  test('returns keyed narrative object on success', async () => {
    const expected = { 'corp-1': 'OmegaCorp rises.', 'corp-2': 'NovaCorp survives.' };
    mockGenerateContent.mockResolvedValue({ response: { text: () => JSON.stringify(expected) } });

    const result = await generateNarratives(fakePairs);
    expect(result).toEqual(expected);
  });

  test('returns {} on Gemini error', async () => {
    mockGenerateContent.mockRejectedValue(new Error('timeout'));
    const result = await generateNarratives(fakePairs);
    expect(result).toEqual({});
  });

  test('returns {} on non-JSON response', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'Here are the narratives:' } });
    const result = await generateNarratives(fakePairs);
    expect(result).toEqual({});
  });

  test('returns {} when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;
    const result = await generateNarratives(fakePairs);
    expect(result).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npm test -- --testPathPattern=gemini
```

Expected: `generateNarratives` tests fail (stub returns `{}`; success test fails since mock is not called).

- [ ] **Step 3: Implement `generateNarratives` in `src/game/gemini.js`**

Replace the `generateNarratives` stub:

```js
async function generateNarratives(corpPayloadPairs) {
  const model = getModel();
  if (!model) {
    console.warn('[gemini] GEMINI_API_KEY not set — narrative generation skipped');
    return {};
  }

  const corpSummaries = corpPayloadPairs.map(({ corp, payload }) => ({
    id: corp.id,
    name: corp.name,
    tick: payload.tick,
    districtCount: payload.holdings.length,
    resources: payload.resources,
    reputationLabel: payload.reputationLabel,
    recentEvents: payload.events.slice(0, 5),
    alliances: payload.alliances.map(a => a.allied_corp_name),
  }));

  const prompt = `You are a cyberpunk city narrator for a corporate strategy game.
Write a 2-3 sentence narrative briefing for each corporation listed.
Write from the corporation's perspective. Dramatic, terse, present tense. Cyberpunk tabloid tone.
Reference specific events, district counts, and reputation where relevant.
Return ONLY a valid JSON object mapping each corp's "id" to a narrative string.
No markdown, no explanation.

${JSON.stringify(corpSummaries, null, 2)}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const json = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(json);
  } catch (err) {
    console.warn('[gemini] generateNarratives failed:', err.message);
    return {};
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=gemini
```

Expected: all `generateNarratives` tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/game/gemini.js tests/game/gemini.test.js
git commit -m "feat: implement generateNarratives with per-corp keyed output"
```

---

### Task 5: `generateHeadlines`

**Files:**
- Modify: `src/game/gemini.js`
- Modify: `tests/game/gemini.test.js`

- [ ] **Step 1: Write failing tests for `generateHeadlines`**

Add to `tests/game/gemini.test.js`:

```js
describe('generateHeadlines', () => {
  // generateHeadlines is imported at the top of the file — no require here.
  let mockGenerateContent;

  beforeEach(() => {
    mockGenerateContent = jest.fn();
    GoogleGenerativeAI.mockImplementation(() => ({
      getGenerativeModel: () => ({ generateContent: mockGenerateContent }),
    }));
    process.env.GEMINI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  const fakeEvents = [
    { type: 'combat', narrative: 'OmegaCorp seized the Midtown Financial Hub.' },
    { type: 'covert', narrative: 'NovaCorp sabotaged the Downtown Power Grid.' },
  ];

  test('returns array of headline strings on success', async () => {
    const expected = ['OMEGACORP SEIZES MIDTOWN', 'NOVACORP STRIKES DOWNTOWN GRID'];
    mockGenerateContent.mockResolvedValue({ response: { text: () => JSON.stringify(expected) } });

    const result = await generateHeadlines(fakeEvents, 5);
    expect(result).toEqual(expected);
  });

  test('returns [] on Gemini error', async () => {
    mockGenerateContent.mockRejectedValue(new Error('rate limit'));
    const result = await generateHeadlines(fakeEvents, 5);
    expect(result).toEqual([]);
  });

  test('returns [] on non-JSON response', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'Here are headlines:' } });
    const result = await generateHeadlines(fakeEvents, 5);
    expect(result).toEqual([]);
  });

  test('returns [] when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;
    const result = await generateHeadlines(fakeEvents, 5);
    expect(result).toEqual([]);
  });

  test('excludes existing headline events from the prompt input', async () => {
    const eventsWithHeadline = [
      { type: 'headline', narrative: 'OLD HEADLINE' },
      { type: 'combat', narrative: 'Corp A attacked Corp B.' },
    ];
    mockGenerateContent.mockResolvedValue({ response: { text: () => '["NEW HEADLINE"]' } });

    await generateHeadlines(eventsWithHeadline, 5);
    // Verify Gemini was called (it was, since API key is set)
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    // Verify the prompt doesn't include the old headline text
    const promptArg = mockGenerateContent.mock.calls[0][0];
    expect(promptArg).not.toContain('OLD HEADLINE');
    expect(promptArg).toContain('Corp A attacked Corp B.');
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npm test -- --testPathPattern=gemini
```

Expected: `returns array of headline strings on success` fails (stub returns `[]`).

- [ ] **Step 3: Implement `generateHeadlines` in `src/game/gemini.js`**

Replace the `generateHeadlines` stub:

```js
async function generateHeadlines(events, tick) {
  const model = getModel();
  if (!model) {
    console.warn('[gemini] GEMINI_API_KEY not set — headline generation skipped');
    return [];
  }

  const eventNarratives = events
    .filter(e => e.type !== 'headline')
    .map(e => e.narrative)
    .filter(Boolean)
    .slice(0, 20);

  const prompt = `You are a cyberpunk tabloid headline writer for a corporate warfare city simulation.
Write 3-5 dramatic tabloid headlines based on the events below.
Rules:
- Name the district and corporation involved where known
- Do NOT reveal resource amounts, energy spent, influence costs, or mechanic numbers
- ALL CAPS, dramatic, terse, tabloid style
- If no major events occurred, write general city-news headlines about corporate tensions
Return ONLY a JSON array of strings. No markdown, no explanation.

Tick: ${tick}
Events:
${eventNarratives.length > 0 ? eventNarratives.join('\n') : 'No major incidents this cycle.'}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const json = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (err) {
    console.warn('[gemini] generateHeadlines failed:', err.message);
    return [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=gemini
```

Expected: all `generateHeadlines` tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/game/gemini.js tests/game/gemini.test.js
git commit -m "feat: implement generateHeadlines; filter out existing headline events from prompt"
```

---

### Task 6: Update `briefing.js` — export `buildAvailableActions` + use `buildFallbackNarrative`

**Files:**
- Modify: `src/api/routes/briefing.js`
- Modify: `tests/api/briefing.test.js`

- [ ] **Step 1: Write failing test for `narrative` field in briefing**

Open `tests/api/briefing.test.js` and add at the bottom:

```js
test('GET /briefing/:agentId returns non-null narrative in live path', async () => {
  // This test relies on the live briefing path. The live path is used when there is no
  // stored briefing matching the current tick. Since beforeEach creates a fresh in-memory
  // DB with tick_count = 0 and no briefings stored, the live path is always taken here.
  // Do NOT call runTick() before this test — that would store a briefing and bypass the live path.
  const storedCount = db.prepare('SELECT COUNT(*) AS n FROM briefings WHERE corp_id = ?').get(corpId).n;
  expect(storedCount).toBe(0); // sanity check: confirm live path will be used

  const res = await request(app).get(`/briefing/${corpId}`).set('Authorization', `Bearer ${apiKey}`);
  expect(res.status).toBe(200);
  expect(res.body.narrative).not.toBeNull();
  expect(typeof res.body.narrative).toBe('string');
  expect(res.body.narrative.length).toBeGreaterThan(0);
});
```

Note: you'll need access to `db` in this test. Check whether the existing `briefing.test.js` exposes the db in its test scope; if not, expose it via the test setup or query via the app's existing db reference.

- [ ] **Step 2: Run to verify test fails**

```bash
npm test -- --testPathPattern=briefing
```

Expected: FAIL — `narrative` is `null`.

- [ ] **Step 3: Update `src/api/routes/briefing.js`**

Make these two changes:

**Change 1** — Add import at top of file (after the existing `require`):
```js
const { buildFallbackNarrative } = require('../../game/gemini');
```

**Change 2** — Replace `narrative: null, // TODO Plan 4: Gemini integration` with:
```js
narrative: buildFallbackNarrative(corp, payload),
```

Note: `buildFallbackNarrative` needs `corp` and the payload being built. At the point where `narrative` is set in the live path, `corp` is available as the local `corp` variable and the payload object is being constructed — call `buildFallbackNarrative` with the same `corp` and a temporary payload object that has the fields it needs (`tick`, `holdings`, `resources`, `reputationLabel`, `events`). Because the payload object is being assembled inline, pass the fields directly:

```js
narrative: buildFallbackNarrative(corp, {
  tick: currentTick,
  holdings,
  resources: {
    credits: corp.credits,
    energy: corp.energy,
    workforce: corp.workforce,
    intelligence: corp.intelligence,
    influence: corp.influence,
    politicalPower: corp.political_power,
  },
  reputationLabel,
  events: recentEvents,
}),
```

**Change 3** — Export `buildAvailableActions` so `tick.js` can import it. Change the bottom of the file from:

```js
function buildAvailableActions(isPariah) {
```

to add `module.exports` at the very end of the file (after the existing `module.exports = function briefingRoute...`):

```js
module.exports.buildAvailableActions = buildAvailableActions;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=briefing
```

Expected: the new `narrative` test passes; all existing tests still pass.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/api/routes/briefing.js tests/api/briefing.test.js
git commit -m "feat: export buildAvailableActions; use buildFallbackNarrative in live briefing path"
```

---

## Chunk 2: Wire into tick.js

### Task 7: Wire Gemini calls into `tick.js`

**Files:**
- Modify: `src/game/tick.js`
- Modify: `tests/game/tick.test.js`

This task makes `runTick` async and adds three new steps. All existing tests must be updated to `await runTick(...)`.

- [ ] **Step 1: Write failing tests for the new tick behaviors**

Open `tests/game/tick.test.js`. Make these changes:

**Change A — Add `jest.mock` at the very top of the file** (after the existing comments, before the existing `require` calls). Jest hoists `jest.mock` calls to the top of the module, but they must be written at the file's top level — not inside a `describe` or appended at the end. Place it immediately after any `// comment` lines, before the first `require`:

```js
// jest.mock must be at the top of the file — Jest hoists it before all requires.
// buildFallbackNarrative is preserved via jest.requireActual so narrative tests get real output.
jest.mock('../../src/game/gemini', () => ({
  parseNLAction: jest.fn().mockResolvedValue(null),
  generateNarratives: jest.fn().mockResolvedValue({}),
  generateHeadlines: jest.fn().mockResolvedValue([]),
  buildFallbackNarrative: jest.requireActual('../../src/game/gemini').buildFallbackNarrative,
}));
```

Note: `uuidv4` and `corpId` are already defined in the existing test file setup — no changes needed for those.

**Change B — Update all 7 existing tests to be async and await `runTick`**. For each existing `test('...', () => {` change to `test('...', async () => {`, and change each bare `runTick(db, seasonId)` call to `await runTick(db, seasonId)`.

**Change C — Add new tests at the bottom**:

test('runTick parses NL submission and writes parsed_actions', async () => {
  const { parseNLAction } = require('../../src/game/gemini');
  const parsedActions = { primaryAction: { type: 'fortify', targetDistrictId: 'some-id' }, freeActions: [] };
  parseNLAction.mockResolvedValueOnce(parsedActions);

  // Insert a pending_action with raw_response and no parsed_actions for tick 0
  const actionId = uuidv4();
  db.prepare(`
    INSERT INTO pending_actions (id, corp_id, tick, raw_response, status)
    VALUES (?, ?, 0, 'fortify my district', 'pending')
  `).run(actionId, corpId);

  await runTick(db, seasonId); // increments to tick 1, resolves tick 0 actions

  const action = db.prepare('SELECT * FROM pending_actions WHERE id = ?').get(actionId);
  expect(action.parsed_actions).toBe(JSON.stringify(parsedActions));
  expect(action.status).toBe('pending'); // still pending — resolveActions picks it up
});

test('runTick rejects NL submission when parseNLAction returns null', async () => {
  const { parseNLAction } = require('../../src/game/gemini');
  parseNLAction.mockResolvedValueOnce(null);

  const actionId = uuidv4();
  db.prepare(`
    INSERT INTO pending_actions (id, corp_id, tick, raw_response, status)
    VALUES (?, ?, 0, 'do something impossible', 'pending')
  `).run(actionId, corpId);

  await runTick(db, seasonId);

  const action = db.prepare('SELECT * FROM pending_actions WHERE id = ?').get(actionId);
  expect(action.status).toBe('rejected');
});

test('runTick stores non-null narrative in briefing payload', async () => {
  await runTick(db, seasonId);
  const briefing = db.prepare('SELECT * FROM briefings WHERE corp_id = ?').get(corpId);
  const payload = JSON.parse(briefing.payload);
  expect(payload.narrative).not.toBeNull();
  expect(typeof payload.narrative).toBe('string');
  expect(payload.narrative.length).toBeGreaterThan(0);
});

test('runTick writes a headline event tagged with newTick', async () => {
  const { generateHeadlines } = require('../../src/game/gemini');
  generateHeadlines.mockResolvedValueOnce(['CORP SEIZES DISTRICT IN DAWN RAID']);

  await runTick(db, seasonId); // newTick = 1

  const headline = db.prepare(
    "SELECT * FROM events WHERE season_id = ? AND type = 'headline' AND tick = 1"
  ).get(seasonId);
  expect(headline).toBeDefined();
  expect(headline.narrative).toContain('CORP SEIZES DISTRICT IN DAWN RAID');
});

test('runTick writes fallback headline when generateHeadlines returns empty array', async () => {
  const { generateHeadlines } = require('../../src/game/gemini');
  generateHeadlines.mockResolvedValueOnce([]);

  await runTick(db, seasonId);

  const headline = db.prepare(
    "SELECT * FROM events WHERE season_id = ? AND type = 'headline' AND tick = 1"
  ).get(seasonId);
  expect(headline).toBeDefined();
  expect(headline.narrative).toContain('CITY GRID STABLE');
});
```

- [ ] **Step 2: Run to verify the new tests fail (and existing tests also fail due to missing await)**

```bash
npm test -- --testPathPattern=tick
```

Expected: multiple failures — existing tests fail because `runTick` is not yet async; new tests fail because behavior isn't implemented.

- [ ] **Step 3: Update `src/game/tick.js`**

Make these changes to `tick.js`:

**Add imports at top** (after existing requires):
```js
const { parseNLAction, generateNarratives, generateHeadlines, buildFallbackNarrative } = require('./gemini');
const { buildAvailableActions } = require('../api/routes/briefing');
const { writeEvent } = require('./events');
```

**Make `runTick` async and add the three new steps:**

```js
async function runTick(db, seasonId) {
  const conn = db || getDb();
  const season = conn.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  if (!season || season.status !== 'active') return;

  // Step 1: Increment tick and set is_ticking flag
  const newTick = season.tick_count + 1;
  conn.prepare('UPDATE seasons SET tick_count = ?, is_ticking = 1 WHERE id = ?').run(newTick, seasonId);
  const updatedSeason = { ...season, tick_count: newTick };

  // Step 2: Resource generation (includes Workforce enforcement)
  generateResources(conn, seasonId, newTick);

  // Step 3: Parse NL submissions for tick = newTick - 1 before resolveActions runs
  const nlRows = conn.prepare(`
    SELECT pa.id, pa.raw_response, pa.corp_id,
           c.name, c.reputation, c.credits, c.energy, c.workforce, c.intelligence, c.influence
    FROM pending_actions pa
    JOIN corporations c ON c.id = pa.corp_id
    WHERE pa.tick = ? AND pa.raw_response IS NOT NULL
      AND pa.parsed_actions IS NULL AND pa.status = 'pending'
  `).all(newTick - 1);

  for (const row of nlRows) {
    const isPariah = row.reputation < 15;
    const availableActions = buildAvailableActions(isPariah);
    const corp = {
      name: row.name, credits: row.credits, energy: row.energy,
      workforce: row.workforce, intelligence: row.intelligence, influence: row.influence,
    };
    const parsed = await parseNLAction(row.raw_response, availableActions, corp);
    if (parsed) {
      conn.prepare('UPDATE pending_actions SET parsed_actions = ? WHERE id = ?')
        .run(JSON.stringify(parsed), row.id);
    } else {
      conn.prepare("UPDATE pending_actions SET status = 'rejected' WHERE id = ?")
        .run(row.id);
    }
  }

  // Steps 4-7: Action resolution
  resolveActions(conn, seasonId, newTick - 1);

  // Step 5: Build briefing payloads for all corps
  const corps = conn.prepare('SELECT * FROM corporations WHERE season_id = ?').all(seasonId);
  const payloads = corps.map(corp => buildBriefingPayload(conn, corp, updatedSeason));

  // Step 6: Generate narratives; fall back per-corp if Gemini omits or fails
  const corpPayloadPairs = corps.map((corp, i) => ({ corp, payload: payloads[i] }));
  const narratives = await generateNarratives(corpPayloadPairs);
  for (const { corp, payload } of corpPayloadPairs) {
    payload.narrative = narratives[corp.id] ?? buildFallbackNarrative(corp, payload);
  }

  // Step 7: Store briefings
  conn.transaction(() => {
    for (let i = 0; i < corps.length; i++) {
      const corp = corps[i];
      const payload = payloads[i];
      conn.prepare(`
        INSERT OR REPLACE INTO briefings (id, corp_id, tick, payload)
        VALUES (?, ?, ?, ?)
      `).run(crypto.randomUUID(), corp.id, newTick, JSON.stringify(payload));
    }
  })();

  // Step 8: Generate and store headlines (tagged tick = newTick; events from newTick - 1)
  const tickEvents = conn.prepare(
    "SELECT * FROM events WHERE season_id = ? AND tick = ? AND type != 'headline'"
  ).all(seasonId, newTick - 1);
  const headlines = await generateHeadlines(tickEvents, newTick - 1);
  const headlineText = headlines.length > 0
    ? headlines.join('\n')
    : 'CITY GRID STABLE — NO MAJOR INCIDENTS REPORTED THIS CYCLE';
  writeEvent(conn, { seasonId, tick: newTick, type: 'headline', narrative: headlineText });

  // Clear is_ticking flag — briefings are now ready
  conn.prepare('UPDATE seasons SET is_ticking = 0 WHERE id = ?').run(seasonId);

  console.log(`[tick ${newTick}] ${corps.length} corps updated`);
}
```

**Update `startTickLoop` to await `runTick`:**

```js
function startTickLoop(db) {
  const conn = db || getDb();
  if (_interval) clearInterval(_interval);
  _lastTick.time = Date.now();

  _interval = setInterval(async () => {
    const s = conn.prepare(
      "SELECT id, tick_interval_ms FROM seasons WHERE status = 'active' LIMIT 1"
    ).get();
    if (!s) return;

    const now = Date.now();
    if (now - _lastTick.time >= s.tick_interval_ms) {
      _lastTick.time = now;
      await runTick(conn, s.id);
    }
  }, 5000);

  console.log('Tick loop started — polling every 5s for active season');
  return _interval;
}
```

- [ ] **Step 4: Run tick tests to verify they pass**

```bash
npm test -- --testPathPattern=tick
```

Expected: all tick tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/game/tick.js tests/game/tick.test.js
git commit -m "feat: wire parseNLAction, generateNarratives, generateHeadlines into async runTick"
```

---

## Final verification

- [ ] **Run the complete test suite one last time**

```bash
npm test
```

Expected: all tests pass with no failures.

- [ ] **Verify game starts without a Gemini key (graceful degrade)**

```bash
node -e "
  const { runTick } = require('./src/game/tick');
  console.log('Loaded OK — Gemini calls will warn and degrade gracefully when GEMINI_API_KEY is unset');
"
```

Expected: no crash, no error — just the module loads.
