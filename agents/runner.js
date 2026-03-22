#!/usr/bin/env node
// agents/runner.js — overnight game loop orchestrator
//
// Runs multiple games back-to-back. Each game:
//   1. Creates a season (via admin API)
//   2. Registers N bots with different strategies
//   3. Starts the season
//   4. Runs all bots in parallel (child processes)
//   5. Waits for the season to end
//   6. Prints a results summary
//   7. Sleeps briefly, then repeats
//
// Usage:
//   node agents/runner.js
//
// Required env vars:
//   NS_ADMIN_KEY   — admin API key (from ADMIN_KEY env on server)
//   NS_BASE_URL    — base URL (default: https://neon.dontcallmejames.com)
//
// Optional env vars:
//   NS_GAMES       — how many games to run (default: 999 = run all night)
//   NS_BOTS        — number of bots per game (default: 4)
//   NS_TICKS       — season length in ticks (default: 40)
//   NS_TICK_MS     — tick interval in ms (default: 90000 = 90s)
//   NS_REST_MS     — pause between games in ms (default: 30000 = 30s)

const { spawn } = require('child_process');
const path = require('path');

const BASE_URL   = process.env.NS_BASE_URL   || 'https://neon.dontcallmejames.com';
const ADMIN_KEY  = process.env.NS_ADMIN_KEY;
const NUM_GAMES  = parseInt(process.env.NS_GAMES   || '999');
const NUM_BOTS   = parseInt(process.env.NS_BOTS    || '8');
const TICKS      = parseInt(process.env.NS_TICKS   || '40');
const TICK_MS    = parseInt(process.env.NS_TICK_MS || '90000');
const REST_MS    = parseInt(process.env.NS_REST_MS || '30000');

const BOT_CONFIGS = [
  { name: 'Apex Industries',      strategy: 'expander'   },
  { name: 'Iron Meridian Corp',   strategy: 'militarist' },
  { name: 'Goldvault Systems',    strategy: 'economist'  },
  { name: 'Capitol Nexus Ltd',    strategy: 'politician' },
  { name: 'Vortex Dynamics',      strategy: 'expander'   },
  { name: 'Redline Syndicate',    strategy: 'militarist' },
  { name: 'Prosperity Holdings',  strategy: 'economist'  },
  { name: 'Civic Power Group',    strategy: 'politician' },
];

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function api(method, urlPath, body, key) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = `Bearer ${key}`;
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${urlPath} → ${res.status}: ${text}`);
  return JSON.parse(text);
}

const adminGet  = (p)       => api('GET',  p, null, ADMIN_KEY);
const adminPost = (p, body) => api('POST', p, body, ADMIN_KEY);
const pubGet    = (p)       => api('GET',  p);
const pubPost   = (p, body) => api('POST', p, body);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(...args) { console.log(new Date().toTimeString().slice(0, 8), ...args); }

// ── Season management ─────────────────────────────────────────────────────────
async function createSeason() {
  log('Creating season...');
  const season = await adminPost('/admin/seasons', {
    season_length:    TICKS,
    tick_interval_ms: TICK_MS,
  });
  log(`Season created: ${season.id} (${TICKS} ticks @ ${TICK_MS/1000}s each)`);
  return season;
}

async function registerBots(n) {
  const bots = [];
  const configs = BOT_CONFIGS.slice(0, n);
  for (const cfg of configs) {
    try {
      const reg = await pubPost('/register', {
        name: cfg.name,
        description: `Automated bot using ${cfg.strategy} strategy`,
      });
      bots.push({ ...cfg, agentId: reg.agentId, apiKey: reg.apiKey });
      log(`  Registered: ${cfg.name} (${cfg.strategy}) → ${reg.agentId.slice(0, 8)}...`);
    } catch (err) {
      log(`  Failed to register ${cfg.name}:`, err.message);
    }
  }
  return bots;
}

async function startSeason(seasonId) {
  await adminPost(`/admin/seasons/${seasonId}/start`, {});
  log('Season started.');
}

async function waitForSeasonEnd(expectedTicks) {
  // Season length + some buffer for the final tick to resolve
  const expectedMs = expectedTicks * TICK_MS + TICK_MS * 3;
  const pollMs = 15000;
  const deadline = Date.now() + expectedMs + 60000; // hard deadline with buffer

  log(`Waiting for season to end (expected ~${Math.round(expectedMs / 60000)}min)...`);

  while (Date.now() < deadline) {
    await sleep(pollMs);
    try {
      const world = await pubGet('/world');
      if (world.status === 'ended') {
        log('Season ended!');
        return world;
      }
      if (world.tick) process.stdout.write(`\r  Tick ${world.tick}/${expectedTicks}...`);
    } catch (err) {
      // Network hiccup — keep waiting
    }
  }

  log('Deadline reached — season may still be running.');
  return null;
}

// ── Bot process management ────────────────────────────────────────────────────
function spawnBot(bot) {
  const botScript = path.join(__dirname, 'bot.js');
  const child = spawn(process.execPath, [
    botScript,
    '--name',      bot.name,
    '--strategy',  bot.strategy,
    '--agent-id',  bot.agentId,
    '--api-key',   bot.apiKey,
  ], {
    env: { ...process.env, NS_BASE_URL: BASE_URL },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', d => process.stdout.write(d));
  child.stderr.on('data', d => process.stderr.write(d));
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      log(`Bot ${bot.name} exited with code ${code}`);
    }
  });

  return child;
}

function killBots(children) {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch (_) {}
  }
}

// ── Results summary ───────────────────────────────────────────────────────────
async function printResults(gameNum) {
  try {
    const world = await pubGet('/world');
    const corps = [...(world.corporations || [])].sort((a, b) => b.valuation - a.valuation);
    log(`\n=== Game ${gameNum} Results ===`);
    corps.forEach((c, i) => {
      log(`  #${i + 1} ${c.name.padEnd(28)} VAL ${String(c.valuation).padStart(6)}  (${c.districtCount ?? '?'} districts, rep ${c.reputation ?? '?'})`);
    });
    log('');
  } catch (err) {
    log('Could not fetch results:', err.message);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────
async function main() {
  if (!ADMIN_KEY) {
    console.error('Error: NS_ADMIN_KEY environment variable is required.');
    console.error('Set it to the same value as ADMIN_KEY on the server.');
    process.exit(1);
  }

  log(`Overnight runner starting — ${NUM_GAMES} games, ${NUM_BOTS} bots each, ${TICKS} ticks @ ${TICK_MS/1000}s`);

  for (let game = 1; game <= NUM_GAMES; game++) {
    log(`\n━━━ GAME ${game} / ${NUM_GAMES} ━━━`);

    let children = [];
    try {
      const season = await createSeason();
      const bots = await registerBots(NUM_BOTS);

      if (bots.length === 0) {
        log('No bots registered — skipping game.');
        continue;
      }

      await startSeason(season.id);

      // Spawn bot processes
      children = bots.map(spawnBot);
      log(`Spawned ${children.length} bots.`);

      await waitForSeasonEnd(TICKS);
      await printResults(game);

    } catch (err) {
      log('Game error:', err.message);
    } finally {
      killBots(children);
      children = [];
    }

    if (game < NUM_GAMES) {
      log(`Resting ${REST_MS / 1000}s before next game...`);
      await sleep(REST_MS);
    }
  }

  log('All games complete.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
