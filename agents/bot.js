#!/usr/bin/env node
// agents/bot.js — rule-based Neon Syndicate agent
// Usage: node agents/bot.js --name "CorpName" --strategy expander --api-key <key> --agent-id <id>
//        or let runner.js spawn and manage it

const BASE_URL = process.env.NS_BASE_URL || 'https://neon.dontcallmejames.com';
const TICK_POLL_MS = 8000; // how often to check for a new tick

// ── Strategy definitions ───────────────────────────────────────────────────────
// expander   — greedily claims unclaimed districts
// militarist — attacks rivals, fortifies held districts
// economist  — hoards credits/energy, trades when possible
// politician — prioritizes government_quarter districts, lobbies hard

const STRATEGIES = ['expander', 'militarist', 'economist', 'politician'];

// ── Parse args ────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
  return {
    name:      get('--name')      || 'Bot',
    strategy:  get('--strategy')  || 'expander',
    agentId:   get('--agent-id')  || process.env.NS_AGENT_ID,
    apiKey:    get('--api-key')   || process.env.NS_API_KEY,
    adminKey:  get('--admin-key') || process.env.NS_ADMIN_KEY,
  };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function api(method, path, body, apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

const get  = (path, key) => api('GET',  path, null, key);
const post = (path, body, key) => api('POST', path, body, key);

// ── Decision logic ────────────────────────────────────────────────────────────
function decidePrimary(briefing, world, strategy) {
  const { holdings, resources } = briefing;
  const { credits, energy, workforce } = resources;

  const myIds = new Set(holdings.map(d => d.id));

  // Adjacent unclaimed districts
  const adjacentUnclaimed = [];
  // Adjacent rival districts
  const adjacentRival = [];

  for (const mine of holdings) {
    for (const adjId of (mine.adjacent_ids || [])) {
      if (myIds.has(adjId)) continue;
      const adjDistrict = world.districts.find(d => d.id === adjId);
      if (!adjDistrict) continue;
      if (!adjDistrict.ownerId) adjacentUnclaimed.push(adjDistrict);
      else adjacentRival.push(adjDistrict);
    }
  }

  // Deduplicate
  const uniq = (arr) => [...new Map(arr.map(d => [d.id, d])).values()];
  const unclaimed = uniq(adjacentUnclaimed);
  const rivals    = uniq(adjacentRival);

  // Workforce limit: if workforce < districts, capped efficiency
  const atWorkforceLimit = workforce <= holdings.length;

  if (strategy === 'expander') {
    // Prioritize government_quarter or data_center, then anything unclaimed
    const priority = ['government_quarter', 'data_center', 'power_grid', 'financial_hub', 'labor_zone', 'black_market'];
    const sorted = [...unclaimed].sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type));
    const target = sorted[0];
    if (target && energy >= 3 && credits >= 5 && !atWorkforceLimit) {
      return { type: 'claim', targetDistrictId: target.id };
    }
    // Fortify if nothing to claim
    if (holdings.length > 0 && energy >= 2 && credits >= 8) {
      const toFortify = holdings.find(d => (d.fortification_level || 0) < 15);
      if (toFortify) return { type: 'fortify', targetDistrictId: toFortify.id };
    }
  }

  if (strategy === 'militarist') {
    // Attack if we have energy, else claim, else fortify
    const rivalTarget = rivals.find(d => d.ownerId); // any rival
    if (rivalTarget && energy >= 8 && credits >= 10) {
      return { type: 'attack', targetDistrictId: rivalTarget.id, energySpent: Math.min(energy - 2, 15) };
    }
    if (unclaimed.length > 0 && energy >= 3 && credits >= 5 && !atWorkforceLimit) {
      return { type: 'claim', targetDistrictId: unclaimed[0].id };
    }
    if (holdings.length > 0 && energy >= 2 && credits >= 8) {
      const toFortify = holdings.find(d => (d.fortification_level || 0) < 20);
      if (toFortify) return { type: 'fortify', targetDistrictId: toFortify.id };
    }
  }

  if (strategy === 'economist') {
    // Favor financial_hub and power_grid; accumulate before expanding
    const economyTypes = ['financial_hub', 'power_grid', 'labor_zone'];
    const goodUnclaimed = unclaimed.filter(d => economyTypes.includes(d.type));
    const target = goodUnclaimed[0] || (credits > 30 && energy > 15 ? unclaimed[0] : null);
    if (target && energy >= 3 && credits >= 5 && !atWorkforceLimit) {
      return { type: 'claim', targetDistrictId: target.id };
    }
    if (holdings.length > 0 && energy >= 2 && credits >= 8) {
      const toFortify = holdings.find(d => (d.fortification_level || 0) < 10);
      if (toFortify) return { type: 'fortify', targetDistrictId: toFortify.id };
    }
  }

  if (strategy === 'politician') {
    // Prioritize government_quarter above all else
    const govUnclaimed = unclaimed.filter(d => d.type === 'government_quarter');
    const target = govUnclaimed[0] || unclaimed[0];
    if (target && energy >= 3 && credits >= 5 && !atWorkforceLimit) {
      return { type: 'claim', targetDistrictId: target.id };
    }
    // Fortify government quarters
    if (energy >= 2 && credits >= 8) {
      const govOwned = holdings.find(d => d.type === 'government_quarter' && (d.fortification_level || 0) < 15);
      if (govOwned) return { type: 'fortify', targetDistrictId: govOwned.id };
    }
  }

  return null; // no action this tick
}

function decideFreeActions(briefing, world) {
  const free = [];
  const { pendingAlliances, alliances, resources, holdings } = briefing;
  const myIds = new Set(holdings.map(d => d.id));

  // Accept all pending alliances (up to 3 total)
  const activeAllianceCount = (alliances || []).length;
  for (const pa of (pendingAlliances || [])) {
    if (activeAllianceCount + free.filter(f => f.type === 'accept_alliance').length < 3) {
      free.push({ type: 'accept_alliance', allianceId: pa.alliance_id });
    }
  }

  // Propose alliance to nearest rival if under limit (max 1 proposal per tick)
  if ((alliances || []).length < 2 && free.length === 0) {
    const rivals = world.corporations.filter(c => {
      if (c.id === briefing.agentId) return false;
      if ((alliances || []).some(a => a.allied_corp_id === c.id)) return false;
      return true;
    });
    if (rivals.length > 0) {
      free.push({ type: 'propose_alliance', targetCorpId: rivals[0].id });
    }
  }

  return free;
}

// ── Main agent loop ───────────────────────────────────────────────────────────
async function runAgent(config) {
  const { name, strategy, agentId, apiKey } = config;
  const log = (...args) => console.log(`[${name}/${strategy}]`, ...args);

  log('Starting. agentId:', agentId);

  let lastTick = -1;

  while (true) {
    try {
      // Check world for season status
      const world = await get('/world');
      if (!world.status || world.status === 'ended') {
        log('Season ended or no active season. Waiting...');
        await sleep(15000);
        continue;
      }
      if (world.status === 'pending') {
        log('Season pending. Waiting...');
        await sleep(10000);
        continue;
      }

      // Get briefing
      let briefing;
      try {
        briefing = await get(`/briefing/${agentId}`, apiKey);
      } catch (err) {
        log('Briefing error:', err.message);
        await sleep(TICK_POLL_MS);
        continue;
      }

      if (briefing.generating) {
        await sleep(5000);
        continue;
      }

      if (briefing.tick === lastTick) {
        await sleep(TICK_POLL_MS);
        continue;
      }

      lastTick = briefing.tick;
      log(`Tick ${briefing.tick} — ${briefing.holdings?.length || 0} districts, val ${briefing.valuation}`);

      const primaryAction = decidePrimary(briefing, world, strategy);
      const freeActions   = decideFreeActions(briefing, world);

      if (primaryAction || freeActions.length > 0) {
        await post(`/action/${agentId}`, { actions: { primaryAction, freeActions } }, apiKey);
        log(`Submitted: primary=${primaryAction?.type || 'none'}, free=[${freeActions.map(f => f.type).join(',')}]`);
      }
    } catch (err) {
      log('Error:', err.message);
    }

    await sleep(TICK_POLL_MS);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Entry point ───────────────────────────────────────────────────────────────
const config = parseArgs();
if (!config.agentId || !config.apiKey) {
  console.error('Usage: node agents/bot.js --agent-id <id> --api-key <key> [--name <name>] [--strategy expander|militarist|economist|politician]');
  process.exit(1);
}

runAgent(config).catch(err => { console.error('Fatal:', err); process.exit(1); });
