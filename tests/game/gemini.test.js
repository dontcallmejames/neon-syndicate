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
    expect(result).toContain('3 events recorded.');
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

describe('parseNLAction', () => {
  let mockGenerateContent;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    mockGenerateContent = jest.fn();
    GoogleGenerativeAI.mockImplementation(() => ({
      getGenerativeModel: () => ({ generateContent: mockGenerateContent }),
    }));
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    jest.clearAllMocks();
  });

  test('returns parsed action structure on valid JSON response', async () => {
    const parsed = { primaryAction: { type: 'claim', targetDistrictId: 'dist1' }, freeActions: [] };
    mockGenerateContent.mockResolvedValue({
      response: { text: () => JSON.stringify(parsed) },
    });

    const result = await parseNLAction('claim district 1', [], { id: 'corp1', name: 'TestCorp', credits: 10, energy: 10 });
    expect(result).toEqual(parsed);
  });

  test('returns null when Gemini returns non-JSON', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'sorry I cannot help with that' },
    });

    const result = await parseNLAction('do something', [], { id: 'corp1', name: 'TestCorp', credits: 10, energy: 10 });
    expect(result).toBeNull();
  });

  test('returns null when Gemini throws', async () => {
    mockGenerateContent.mockRejectedValue(new Error('API error'));

    const result = await parseNLAction('do something', [], { id: 'corp1', name: 'TestCorp', credits: 10, energy: 10 });
    expect(result).toBeNull();
  });

  test('returns null when parsed JSON lacks required keys', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => JSON.stringify({ someOtherKey: true }) },
    });

    const result = await parseNLAction('do something', [], { id: 'corp1', name: 'TestCorp', credits: 10, energy: 10 });
    expect(result).toBeNull();
  });
});

describe('generateNarratives', () => {
  let mockGenerateContent;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    mockGenerateContent = jest.fn();
    GoogleGenerativeAI.mockImplementation(() => ({
      getGenerativeModel: () => ({ generateContent: mockGenerateContent }),
    }));
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    jest.clearAllMocks();
  });

  test('returns narrative map keyed by corp id on valid response', async () => {
    const corpPayloadPairs = [
      { corp: { id: 'corp1', name: 'Alpha Inc', reputation: 50, reputationLabel: 'Neutral' }, payload: { tick: 1, holdings: [], resources: { credits: 10, energy: 5, workforce: 0, intelligence: 0, influence: 0, politicalPower: 0 }, events: [] } },
      { corp: { id: 'corp2', name: 'Beta Corp', reputation: 30, reputationLabel: 'Notorious' }, payload: { tick: 1, holdings: [], resources: { credits: 20, energy: 8, workforce: 0, intelligence: 0, influence: 0, politicalPower: 0 }, events: [] } },
    ];
    const geminiResponse = { corp1: 'Alpha narrative.', corp2: 'Beta narrative.' };
    mockGenerateContent.mockResolvedValue({
      response: { text: () => JSON.stringify(geminiResponse) },
    });

    const result = await generateNarratives(corpPayloadPairs);
    expect(result).toEqual(geminiResponse);
  });

  test('returns partial map when Gemini omits a corp key', async () => {
    const corpPayloadPairs = [
      { corp: { id: 'corp1', name: 'Alpha Inc', reputation: 50, reputationLabel: 'Neutral' }, payload: { tick: 1, holdings: [], resources: { credits: 10, energy: 5, workforce: 0, intelligence: 0, influence: 0, politicalPower: 0 }, events: [] } },
      { corp: { id: 'corp2', name: 'Beta Corp', reputation: 30, reputationLabel: 'Notorious' }, payload: { tick: 1, holdings: [], resources: { credits: 20, energy: 8, workforce: 0, intelligence: 0, influence: 0, politicalPower: 0 }, events: [] } },
    ];
    mockGenerateContent.mockResolvedValue({
      response: { text: () => JSON.stringify({ corp1: 'Only Alpha.' }) },
    });

    const result = await generateNarratives(corpPayloadPairs);
    expect(result).toEqual({ corp1: 'Only Alpha.' });
    // corp2 key is absent — caller handles fallback
    expect(result.corp2).toBeUndefined();
  });

  test('returns empty object when Gemini returns non-JSON', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'not json at all' },
    });

    const result = await generateNarratives([
      { corp: { id: 'corp1', name: 'Alpha Inc', reputation: 50, reputationLabel: 'Neutral' }, payload: { tick: 1, holdings: [], resources: { credits: 10, energy: 5, workforce: 0, intelligence: 0, influence: 0, politicalPower: 0 }, events: [] } },
    ]);
    expect(result).toEqual({});
  });

  test('returns empty object when Gemini throws', async () => {
    mockGenerateContent.mockRejectedValue(new Error('network error'));

    const result = await generateNarratives([
      { corp: { id: 'corp1', name: 'Alpha Inc', reputation: 50, reputationLabel: 'Neutral' }, payload: { tick: 1, holdings: [], resources: { credits: 10, energy: 5, workforce: 0, intelligence: 0, influence: 0, politicalPower: 0 }, events: [] } },
    ]);
    expect(result).toEqual({});
  });
});

describe('generateNarratives — no API key', () => {
  test('returns empty object when GEMINI_API_KEY is not set', async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const result = await generateNarratives([
        { corp: { id: 'corp1', name: 'Alpha Inc', reputation: 50 }, payload: { tick: 1, holdings: [], resources: { credits: 10, energy: 5, workforce: 0, intelligence: 0, influence: 0, politicalPower: 0 }, events: [] } },
      ]);
      expect(result).toEqual({});
    } finally {
      process.env.GEMINI_API_KEY = savedKey;
    }
  });
});

describe('generateHeadlines', () => {
  let mockGenerateContent;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    mockGenerateContent = jest.fn();
    GoogleGenerativeAI.mockImplementation(() => ({
      getGenerativeModel: () => ({ generateContent: mockGenerateContent }),
    }));
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    jest.clearAllMocks();
  });

  test('returns array of headline strings on valid response', async () => {
    const headlines = ['CORP SEIZES DISTRICT', 'BLACKOUT IN SECTOR 7'];
    mockGenerateContent.mockResolvedValue({
      response: { text: () => JSON.stringify(headlines) },
    });

    const result = await generateHeadlines([{ type: 'claim', narrative: 'Alpha took a district' }], 1);
    expect(result).toEqual(headlines);
  });

  test('returns fallback when Gemini throws', async () => {
    mockGenerateContent.mockRejectedValue(new Error('timeout'));

    const result = await generateHeadlines([], 1);
    expect(result).toEqual(['CITY GRID STABLE — NO MAJOR INCIDENTS REPORTED THIS CYCLE']);
  });

  test('returns fallback when Gemini returns non-JSON', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'oops not json' },
    });

    const result = await generateHeadlines([], 1);
    expect(result).toEqual(['CITY GRID STABLE — NO MAJOR INCIDENTS REPORTED THIS CYCLE']);
  });

  test('returns fallback when Gemini returns empty array', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => JSON.stringify([]) },
    });

    const result = await generateHeadlines([], 1);
    expect(result).toEqual(['CITY GRID STABLE — NO MAJOR INCIDENTS REPORTED THIS CYCLE']);
  });

  test('returns fallback when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;
    const result = await generateHeadlines([], 1);
    expect(result).toEqual(['CITY GRID STABLE — NO MAJOR INCIDENTS REPORTED THIS CYCLE']);
  });
});

describe('parseNLAction — no API key', () => {
  let originalKey;
  beforeEach(() => {
    originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });
  afterEach(() => {
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
    jest.restoreAllMocks();
  });

  test('returns null when GEMINI_API_KEY is not set', async () => {
    const result = await parseNLAction('buy some credits', [], { id: 'corp1', name: 'TestCorp' });
    expect(result).toBeNull();
  });

  test('logs a warning when GEMINI_API_KEY is not set', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await parseNLAction('buy some credits', [], { id: 'corp1', name: 'TestCorp' });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('GEMINI_API_KEY'));
  });
});
