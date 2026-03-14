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
    ? `${payload.events.length} events recorded.`
    : 'No significant events this cycle.';
  return `Tick ${payload.tick}. ${corp.name} controls ${payload.holdings.length} district(s). Credits: ${payload.resources.credits} | Energy: ${payload.resources.energy} | Reputation: ${payload.reputationLabel}. ${eventSummary}`;
}

async function parseNLAction(rawResponse, availableActions, corp) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[gemini] GEMINI_API_KEY not set — skipping NL action parsing');
    return null;
  }
  // TODO Task 3
  return null;
}

async function generateNarratives(corpPayloadPairs) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[gemini] GEMINI_API_KEY not set — skipping narrative generation');
    return {};
  }
  // TODO Task 4
  return {};
}

async function generateHeadlines(events, tick) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[gemini] GEMINI_API_KEY not set — skipping headline generation');
    return [];
  }
  // TODO Task 5
  return [];
}

module.exports = { parseNLAction, generateNarratives, generateHeadlines, buildFallbackNarrative };
