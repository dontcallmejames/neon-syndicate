// src/game/gemini.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../lib/logger');

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
    logger.warn('gemini', 'GEMINI_API_KEY not set — skipping NL action parsing');
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
    const result = await model.generateContent(prompt, { signal: AbortSignal.timeout(15000) });
    const text = result.response.text();
    const parsed = JSON.parse(stripMarkdownFences(text));
    if (!parsed.primaryAction || !Array.isArray(parsed.freeActions)) return null;
    return parsed;
  } catch (err) {
    logger.warn('gemini', 'parseNLAction error', { err: err.message });
    return null;
  }
}

async function generateNarratives(corpPayloadPairs) {
  if (!process.env.GEMINI_API_KEY) {
    logger.warn('gemini', 'GEMINI_API_KEY not set — skipping narrative generation');
    return {};
  }

  const model = getModel();
  const corpSummaries = corpPayloadPairs.map(({ corp, payload }) => ({
    id: corp.id,
    name: corp.name,
    tick: payload.tick,
    districts: payload.holdings.map(h => ({ name: h.name, type: h.type })),
    resources: payload.resources,
    reputationLabel: payload.reputationLabel,
    alliances: (payload.alliances || []).map(a => a.allied_corp_name),
    activeLaw: payload.activeLaw?.name ?? null,
    events: payload.events.slice(0, 5),
  }));

  const prompt = `You are a rogue AI broadcasting encrypted intel from Neo-Meridian — a neon megacity where megacorps carve up territory tick by tick. Write a 2-3 sentence corporate intelligence dispatch for each corp below.

Rules:
- Name the specific districts the corp holds (use the district names given)
- Reference their reputation, alliances, and any events — by name
- If a law is active, weave it in as street-level consequence
- Terse, present-tense, cyberpunk tabloid voice — not a status report
- No resource numbers. No game mechanic jargon. Pure street-level drama.

Return ONLY valid JSON, no markdown: { "<corpId>": "dispatch string", ... }

Corps:
${JSON.stringify(corpSummaries, null, 2)}`;

  try {
    const result = await model.generateContent(prompt, { signal: AbortSignal.timeout(15000) });
    const text = result.response.text();
    return JSON.parse(stripMarkdownFences(text));
  } catch (err) {
    logger.warn('gemini', 'generateNarratives error', { err: err.message });
    return {};
  }
}

async function generateHeadlines(events, tick, worldContext = {}) {
  if (!process.env.GEMINI_API_KEY) {
    logger.warn('gemini', 'GEMINI_API_KEY not set — skipping headline generation');
    return [FALLBACK_HEADLINE];
  }

  const model = getModel();
  const hasEvents = events && events.length > 0;
  const eventSummaries = hasEvents
    ? events.map(e => ({ type: e.type, narrative: e.narrative }))
    : [];

  const { topCorps = [], activeLaw = null } = worldContext;
  const cityBlock = [
    topCorps.length
      ? `Power balance: ${topCorps.map(c => `${c.name} (${c.districtCount} districts)`).join(', ')}`
      : '',
    activeLaw ? `Active city law: ${activeLaw}` : '',
  ].filter(Boolean).join('. ');

  const preamble = `You are the Neo-Meridian Dispatch — a rogue cyberpunk tabloid broadcasting live from a megacity carved up by warring corporations. ALL CAPS. Punchy. Present tense. Name corps and districts.${cityBlock ? `\nCity state: ${cityBlock}` : ''}`;

  const prompt = hasEvents
    ? `${preamble}

Tick ${tick} just resolved. Write 3-5 tabloid headlines from these events. Name the actual corporations and districts. Street-level drama — no resource numbers, no game mechanic jargon.

Events:
${JSON.stringify(eventSummaries, null, 2)}

Return ONLY a JSON array of strings: ["HEADLINE ONE", "HEADLINE TWO", ...]`
    : `${preamble}

Tick ${tick} — the boardrooms were quiet, but the streets never sleep. Write 3-5 dispatch headlines covering ambient megacity life: corporate surveillance, district unrest, black-market rumors, power broker gossip. Reference the corps and districts by name.

Return ONLY a JSON array of strings: ["HEADLINE ONE", "HEADLINE TWO", ...]`;

  try {
    const result = await model.generateContent(prompt, { signal: AbortSignal.timeout(15000) });
    const text = result.response.text();
    const parsed = JSON.parse(stripMarkdownFences(text));
    if (!Array.isArray(parsed) || parsed.length === 0) return [FALLBACK_HEADLINE];
    return parsed;
  } catch (err) {
    logger.warn('gemini', 'generateHeadlines error', { err: err.message });
    return [FALLBACK_HEADLINE];
  }
}

module.exports = { parseNLAction, generateNarratives, generateHeadlines, buildFallbackNarrative };
