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
// saboteur   — uses covert ops (sabotage, leak_scandal) to weaken rivals
// diplomat   — maximizes alliances and trade volume, avoids direct conflict
// opportunist— waits for rivals to weaken each other, then strikes
// hoarder    — accumulates resources early, then expands aggressively late game

const STRATEGIES = ['expander', 'militarist', 'economist', 'politician', 'saboteur', 'diplomat', 'opportunist', 'hoarder'];

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

  if (strategy === 'saboteur') {
    const { influence, intelligence } = resources;
    // Sabotage a rival district (halves production for 2 ticks)
    if (rivals.length > 0 && energy >= 4 && credits >= 15 && influence >= 5) {
      // Target the highest-value district type
      const priority = ['financial_hub', 'data_center', 'power_grid', 'government_quarter', 'labor_zone', 'black_market'];
      const target = [...rivals].sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type))[0];
      if (target) return { type: 'sabotage', targetDistrictId: target.id };
    }
    // Leak scandal to tank a rival's reputation (targets a corp, not a district)
    if (rivals.length > 0 && energy >= 2 && credits >= 10 && influence >= 5) {
      return { type: 'leak_scandal', targetCorpId: rivals[0].ownerId };
    }
    // Counter-intelligence to protect self (costs 3 energy + 5 influence)
    if (intelligence >= 10 && energy >= 3 && influence >= 5) {
      return { type: 'counter_intelligence' };
    }
    // Fall back to claiming if covert ops aren't available yet
    if (unclaimed.length > 0 && energy >= 3 && credits >= 5 && !atWorkforceLimit) {
      return { type: 'claim', targetDistrictId: unclaimed[0].id };
    }
  }

  if (strategy === 'diplomat') {
    // Claim only if we have few districts — prefers not to be a threat
    if (holdings.length < 4 && unclaimed.length > 0 && energy >= 3 && credits >= 5 && !atWorkforceLimit) {
      // Avoid aggressive district types; prefer labor_zone, financial_hub
      const safe = ['labor_zone', 'financial_hub', 'power_grid', 'black_market', 'data_center', 'government_quarter'];
      const sorted = [...unclaimed].sort((a, b) => safe.indexOf(a.type) - safe.indexOf(b.type));
      return { type: 'claim', targetDistrictId: sorted[0].id };
    }
    // Fortify lightly — enough to deter, not to escalate
    if (holdings.length > 0 && energy >= 2 && credits >= 8) {
      const toFortify = holdings.find(d => (d.fortification_level || 0) < 8);
      if (toFortify) return { type: 'fortify', targetDistrictId: toFortify.id };
    }
  }

  if (strategy === 'opportunist') {
    // Attack only rivals with low fortification (easy pickings after others have fought)
    const weakRivals = rivals.filter(d => (d.fortification_level || 0) < 5);
    if (weakRivals.length > 0 && energy >= 8 && credits >= 10) {
      return { type: 'attack', targetDistrictId: weakRivals[0].id, energySpent: Math.min(energy - 2, 12) };
    }
    // Otherwise claim unclaimed while waiting
    if (unclaimed.length > 0 && energy >= 3 && credits >= 5 && !atWorkforceLimit) {
      return { type: 'claim', targetDistrictId: unclaimed[0].id };
    }
    // Fortify while waiting for opportunities
    if (holdings.length > 0 && energy >= 2 && credits >= 8) {
      const toFortify = holdings.find(d => (d.fortification_level || 0) < 12);
      if (toFortify) return { type: 'fortify', targetDistrictId: toFortify.id };
    }
  }

  if (strategy === 'hoarder') {
    const totalResources = credits + energy * 2 + workforce * 3;
    // Early game: only fortify, no expansion until resource-rich
    if (totalResources < 120) {
      if (holdings.length > 0 && energy >= 2 && credits >= 8) {
        const toFortify = holdings.find(d => (d.fortification_level || 0) < 20);
        if (toFortify) return { type: 'fortify', targetDistrictId: toFortify.id };
      }
      // Claim only if we have almost nothing
      if (holdings.length < 2 && unclaimed.length > 0 && energy >= 3 && credits >= 5 && !atWorkforceLimit) {
        return { type: 'claim', targetDistrictId: unclaimed[0].id };
      }
    } else {
      // Late game flood: claim as fast as possible
      const priority = ['financial_hub', 'power_grid', 'data_center', 'government_quarter', 'labor_zone', 'black_market'];
      const sorted = [...unclaimed].sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type));
      if (sorted.length > 0 && energy >= 3 && credits >= 5 && !atWorkforceLimit) {
        return { type: 'claim', targetDistrictId: sorted[0].id };
      }
      // Attack weakened rivals to accelerate expansion
      if (rivals.length > 0 && energy >= 8 && credits >= 10) {
        return { type: 'attack', targetDistrictId: rivals[0].id, energySpent: Math.min(energy - 2, 15) };
      }
    }
  }

  return null; // no action this tick
}

// Laws each strategy prefers, in priority order
const STRATEGY_LAW_PREFS = {
  expander:    ['open_borders', 'fortify_discount', 'free_trade'],
  militarist:  ['crackdown', 'security_lockdown', 'fortify_discount'],
  economist:   ['free_trade', 'data_center_bonus', 'fortify_discount'],
  politician:  ['transparency', 'open_borders', 'free_trade'],
  saboteur:    ['security_lockdown', 'crackdown', 'transparency'],
  diplomat:    ['free_trade', 'open_borders', 'transparency'],
  opportunist: ['open_borders', 'crackdown', 'fortify_discount'],
  hoarder:     ['data_center_bonus', 'fortify_discount', 'free_trade'],
};

function decideFreeActions(briefing, world, strategy) {
  const free = [];
  const { pendingAlliances, alliances, pendingTrades, resources, holdings, laws, activeLaw, agentId } = briefing;
  const { credits, energy, workforce, intelligence } = resources;

  // ── Accept pending alliances (up to 3 total) ──────────────────────────────
  // Only accept alliances from corps that hold at least 1 district (filters out
  // throwaway/empty corps used to spam-fill alliance slots).
  const activeAllianceCount = (alliances || []).length;
  for (const pa of (pendingAlliances || [])) {
    if (activeAllianceCount + free.filter(f => f.type === 'accept_alliance').length < 3) {
      const proposer = world.corporations.find(c => c.id === pa.proposer_id);
      if (proposer && (proposer.districtCount || 0) >= 1) {
        free.push({ type: 'accept_alliance', allianceId: pa.alliance_id });
      }
    }
  }

  // ── Accept pending trades that are favorable ───────────────────────────────
  // pendingTrades in briefing are already filtered to trades targeting this corp
  // Track remaining resources so we don't accept more trades than we can afford
  const remaining = { credits, energy, workforce, intelligence, influence: resources.influence || 0, politicalPower: resources.politicalPower || 0 };
  for (const trade of (pendingTrades || [])) {
    const offer   = trade.offer   || {};
    const request = trade.request || {};
    // Reject trades where the offer is empty or has no positive value
    const offerTotal = Object.values(offer).reduce((sum, v) => sum + (v || 0), 0);
    if (offerTotal <= 0) continue;
    // Reject trades where we give away far more than we receive
    const requestTotal = Object.values(request).reduce((sum, v) => sum + (v || 0), 0);
    if (requestTotal > 0 && offerTotal < requestTotal * 0.5) continue;
    const canAfford = Object.entries(request).every(([r, amt]) => (remaining[r] ?? 0) >= amt);
    if (canAfford) {
      // Deduct requested resources from our running total
      for (const [r, amt] of Object.entries(request)) {
        remaining[r] = (remaining[r] ?? 0) - amt;
      }
      free.push({ type: 'accept_trade', tradeId: trade.trade_id });
    }
  }

  // ── Propose alliance if under limit (max 1 per tick) ──────────────────────
  if ((alliances || []).length < 2) {
    // Pick the corp with lowest valuation (easiest to ally with) that we're not already allied to
    const alreadyAllied = new Set((alliances || []).map(a => a.allied_corp_id));
    const candidates = world.corporations
      .filter(c => c.id !== agentId && !alreadyAllied.has(c.id))
      .sort((a, b) => (a.valuation || 0) - (b.valuation || 0));
    if (candidates.length > 0) {
      free.push({ type: 'propose_alliance', targetCorpId: candidates[0].id });
    }
  }

  // ── Propose a trade if economist or have excess resources ─────────────────
  const allianceIds = new Set((alliances || []).map(a => a.allied_corp_id));
  const tradeCandidates = world.corporations.filter(c => c.id !== agentId);
  if (tradeCandidates.length > 0 && credits >= 20) {
    // Pick an allied corp first (no fee), otherwise any corp
    const target = tradeCandidates.find(c => allianceIds.has(c.id)) || tradeCandidates[0];
    // Offer something we have surplus of; request something strategically useful
    let offer = null;
    let request = null;
    if (strategy === 'economist' && credits >= 30) {
      offer = { credits: 10 };
      request = { energy: 5 };
    } else if (strategy === 'militarist' && energy >= 20) {
      offer = { energy: 8 };
      request = { credits: 10 };
    } else if (strategy === 'politician' && credits >= 25) {
      offer = { credits: 10 };
      request = { influence: 3 };
    } else if (strategy === 'expander' && workforce >= 8) {
      offer = { workforce: 2 };
      request = { credits: 8 };
    } else if (strategy === 'diplomat' && credits >= 25) {
      // Diplomat trades freely to build relationships
      offer = { credits: 8 };
      request = { energy: 4 };
    } else if (strategy === 'hoarder' && credits >= 40) {
      // Hoarder only trades when flush with credits
      offer = { credits: 12 };
      request = { energy: 6 };
    } else if (strategy === 'saboteur' && energy >= 15) {
      offer = { energy: 5 };
      request = { credits: 8 };
    } else if (strategy === 'opportunist' && credits >= 30) {
      offer = { credits: 8 };
      request = { energy: 5 };
    }
    if (offer && request) {
      free.push({ type: 'propose_trade', targetCorpId: target.id, offer, request });
    }
  }

  // ── Lobby for preferred law ────────────────────────────────────────────────
  if (!activeLaw && (laws || []).length > 0 && credits >= 20) {
    const prefs = STRATEGY_LAW_PREFS[strategy] || [];
    // Find the highest-priority preferred law that exists
    let targetLaw = null;
    for (const effect of prefs) {
      targetLaw = laws.find(l => l.effect === effect && !l.is_active);
      if (targetLaw) break;
    }
    // Fall back to any inactive law
    if (!targetLaw) targetLaw = laws.find(l => !l.is_active);
    if (targetLaw) {
      // Politician spends more; others spend a moderate amount
      // Reserve at least 25 credits so the bot can still claim/fortify
      const lobbyCredits = strategy === 'politician' ? Math.min(credits - 25, 40) : 20;
      if (lobbyCredits >= 10) {
        free.push({ type: 'lobby', lawId: targetLaw.id, credits: lobbyCredits });
      }
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

      briefing.agentId = agentId; // inject so decideFreeActions can filter self
      const primaryAction = decidePrimary(briefing, world, strategy);
      const freeActions   = decideFreeActions(briefing, world, strategy);

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
if (!STRATEGIES.includes(config.strategy)) {
  console.error(`Unknown strategy "${config.strategy}". Valid: ${STRATEGIES.join(', ')}`);
  process.exit(1);
}

runAgent(config).catch(err => { console.error('Fatal:', err); process.exit(1); });
