// src/game/gemini.js
const { GoogleGenerativeAI } = require('@google/generative-ai');

const FALLBACK_HEADLINE = 'CITY GRID STABLE — NO MAJOR INCIDENTS REPORTED THIS CYCLE';

function stripMarkdownFences(text) {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

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
    ? `${payload.events.length} events recorded.`
    : 'No significant events this cycle.';
  return `Tick ${payload.tick}. ${corp.name} controls ${payload.holdings.length} district(s). Credits: ${payload.resources.credits} | Energy: ${payload.resources.energy} | Reputation: ${payload.reputationLabel}. ${eventSummary}`;
}

async function parseNLAction(rawResponse, availableActions, corp) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[gemini] GEMINI_API_KEY not set — skipping NL action parsing');
    return null;
  }

  const model = getModel();
  const prompt = `You are an AI parsing a natural language action submission for a cyberpunk corporate strategy game.

Corp: ${corp.name}
Resources: Credits ${corp.credits} | Energy ${corp.energy} | Workforce ${corp.workforce} | Intelligence ${corp.intelligence} | Influence ${corp.influence} | Political Power ${corp.political_power}
Available actions: ${JSON.stringify(availableActions, null, 2)}

Agent submission: "${rawResponse}"

Return ONLY valid JSON, no markdown, no explanation:
{ "primaryAction": { "type": "...", ...fields }, "freeActions": [...] }`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(stripMarkdownFences(text));
    if (!parsed.primaryAction || !Array.isArray(parsed.freeActions)) return null;
    return parsed;
  } catch (err) {
    console.warn('[gemini] parseNLAction error:', err.message);
    return null;
  }
}

async function generateNarratives(corpPayloadPairs) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[gemini] GEMINI_API_KEY not set — skipping narrative generation');
    return {};
  }

  const model = getModel();
  const corpSummaries = corpPayloadPairs.map(({ corp, payload }) => {
    const reputationLabel =
      corp.reputation >= 75 ? 'Trusted' :
      corp.reputation >= 40 ? 'Neutral' :
      corp.reputation >= 15 ? 'Notorious' : 'Pariah';
    return {
      id: corp.id,
      name: corp.name,
      tick: payload.tick,
      holdings: payload.holdings.length,
      resources: payload.resources,
      reputationLabel,
      eventCount: payload.events.length,
      events: payload.events.slice(0, 5),
    };
  });

  const prompt = `You are writing cyberpunk tabloid briefings for a corporate strategy game. Write from each corp's perspective — dramatic, terse, present tense.

For each corporation below, write 2-3 sentences of cyberpunk prose referencing their specific situation: district control, resources, and notable events such as district changes, messages received, and laws enacted. Maintain a cyberpunk tabloid tone — dramatic, terse, present tense.

Return ONLY valid JSON, no markdown, no explanation:
{ "<corpId>": "narrative string", ... }

Corporations:
${JSON.stringify(corpSummaries, null, 2)}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return JSON.parse(stripMarkdownFences(text));
  } catch (err) {
    console.warn('[gemini] generateNarratives error:', err.message);
    return {};
  }
}

async function generateHeadlines(events, tick) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[gemini] GEMINI_API_KEY not set — skipping headline generation');
    return [FALLBACK_HEADLINE];
  }

  const model = getModel();
  const hasEvents = events && events.length > 0;
  const eventSummaries = hasEvents
    ? events.map(e => ({ type: e.type, narrative: e.narrative }))
    : [];

  const prompt = hasEvents
    ? `You are writing cyberpunk tabloid headlines for a corporate strategy game. Tick ${tick} just resolved.

Write 3-5 short, punchy tabloid headlines based on these events. Name districts and corporations involved. Do NOT reveal specific resource amounts or game mechanics. Dramatic, present tense, ALL CAPS style.

Events:
${JSON.stringify(eventSummaries, null, 2)}

Return ONLY a JSON array of strings: ["HEADLINE ONE", "HEADLINE TWO", ...]`
    : `You are writing cyberpunk tabloid headlines for a corporate strategy game. Tick ${tick} was quiet — no major corporate actions.

Write 3-5 short generic city-news headlines. Dramatic, present tense, ALL CAPS style.

Return ONLY a JSON array of strings: ["HEADLINE ONE", "HEADLINE TWO", ...]`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(stripMarkdownFences(text));
    if (!Array.isArray(parsed) || parsed.length === 0) return [FALLBACK_HEADLINE];
    return parsed;
  } catch (err) {
    console.warn('[gemini] generateHeadlines error:', err.message);
    return [FALLBACK_HEADLINE];
  }
}

module.exports = { parseNLAction, generateNarratives, generateHeadlines, buildFallbackNarrative };
