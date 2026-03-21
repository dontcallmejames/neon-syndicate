// src/game/actions/resolve.js
const { applyFeared } = require('../feared');
const { checkPhase } = require('../phase');
const { validateActions } = require('./validate');
const { resolveCombat } = require('./combat');
const { resolveCovert } = require('./covert');
const { resolveAlliances } = require('./alliances');
const { resolveTrades } = require('./trades');
const { resolveSocial } = require('./social');

const COVERT_OP_TYPES = ['sabotage', 'leak_scandal', 'corporate_assassination'];
const COMBAT_TYPES = ['claim', 'attack'];
const ALLIANCE_TYPES = ['propose_alliance', 'accept_alliance', 'decline_alliance', 'break_alliance'];
const TRADE_TYPES = ['propose_trade', 'accept_trade', 'decline_trade'];
const SOCIAL_TYPES = ['message', 'lobby', 'embargo'];

function resolveActions(db, seasonId, tick) {
  // Step 3: Feared mechanic
  applyFeared(db, seasonId, tick);

  // Fetch all pending, parsed actions for this tick
  const pendingRows = db.prepare(`
    SELECT pa.id, pa.corp_id, pa.tick, pa.parsed_actions, pa.status
    FROM pending_actions pa
    WHERE pa.tick = ? AND pa.status = 'pending' AND pa.parsed_actions IS NOT NULL
  `).all(tick);

  // Step 5: Resolve counter-intelligence
  const ciCorpIds = new Set();
  for (const row of pendingRows) {
    const parsed = JSON.parse(row.parsed_actions);
    if (parsed.primaryAction && parsed.primaryAction.type === 'counter_intelligence') {
      ciCorpIds.add(row.corp_id);
    }
  }

  // Nullify covert actions targeting CI corps; consume their costs
  const nullifiedRowIds = new Set();
  if (ciCorpIds.size > 0) {
    const activeLaw = db.prepare(
      'SELECT effect FROM laws WHERE season_id = ? AND is_active = 1'
    ).get(seasonId);

    for (const row of pendingRows) {
      const parsed = JSON.parse(row.parsed_actions);
      const pa = parsed.primaryAction;
      if (!pa || !COVERT_OP_TYPES.includes(pa.type)) continue;

      const targetCorpId = pa.targetCorpId ||
        (pa.targetDistrictId
          ? db.prepare('SELECT owner_id FROM districts WHERE id = ?').get(pa.targetDistrictId)?.owner_id
          : null);
      if (!targetCorpId || !ciCorpIds.has(targetCorpId)) continue;

      // Nullify: consume costs, mark as resolved, skip execution
      const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(row.corp_id);
      const isPariah = corp.reputation < 15;
      let energyCost = pa.type === 'sabotage' ? 4 : pa.type === 'leak_scandal' ? 2 : 8;
      const creditCost = pa.type === 'sabotage' ? 15 : pa.type === 'leak_scandal' ? 10 : 15;
      let influenceCost = isPariah ? 0 : (pa.type === 'corporate_assassination' ? 10 : 5);

      // Apply law modifiers (same logic as validate.js)
      if (activeLaw?.effect === 'security_lockdown' && pa.type !== 'corporate_assassination') {
        energyCost *= 2;
      }
      if (activeLaw?.effect === 'crackdown' && pa.type !== 'corporate_assassination' && !isPariah) {
        influenceCost *= 2;
      }

      db.prepare('UPDATE corporations SET energy = energy - ?, credits = credits - ?, influence = MAX(0, influence - ?) WHERE id = ?')
        .run(energyCost, creditCost, influenceCost, row.corp_id);
      db.prepare("UPDATE pending_actions SET status = 'resolved' WHERE id = ?").run(row.id);
      nullifiedRowIds.add(row.id);
    }
  }

  // Step 6: Validate remaining actions
  const validActions = {};
  for (const row of pendingRows) {
    if (nullifiedRowIds.has(row.id)) continue;
    const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(row.corp_id);
    const parsed = JSON.parse(row.parsed_actions);
    const result = validateActions(db, corp, parsed, tick);
    if (result.valid) {
      validActions[row.corp_id] = { row, parsed, corp };
    } else {
      db.prepare("UPDATE pending_actions SET status = 'rejected' WHERE id = ?").run(row.id);
    }
  }

  // Classify actions by type
  const combatActions = [];
  const covertActions = [];
  const allianceActions = [];
  const tradeActions = [];
  const socialActions = [];

  for (const { corp, parsed } of Object.values(validActions)) {
    const { primaryAction, freeActions = [] } = parsed;

    if (primaryAction) {
      const entry = { corpId: corp.id, action: primaryAction };
      if (COMBAT_TYPES.includes(primaryAction.type)) combatActions.push(entry);
      else if (COVERT_OP_TYPES.includes(primaryAction.type) || primaryAction.type === 'fortify') covertActions.push(entry);
      else if (ALLIANCE_TYPES.includes(primaryAction.type)) allianceActions.push(entry);
    }

    for (const fa of freeActions) {
      const entry = { corpId: corp.id, action: fa };
      if (ALLIANCE_TYPES.includes(fa.type)) allianceActions.push(entry);
      else if (TRADE_TYPES.includes(fa.type)) tradeActions.push(entry);
      else if (SOCIAL_TYPES.includes(fa.type)) socialActions.push(entry);
    }
  }

  // Deduct costs for counter_intelligence primary actions
  // (CI protection was already recorded via ciCorpIds; costs must be consumed here)
  for (const { row, parsed } of Object.values(validActions)) {
    const primaryAction = parsed.primaryAction;
    if (primaryAction && primaryAction.type === 'counter_intelligence') {
      db.prepare('UPDATE corporations SET energy = energy - 3, influence = influence - 5 WHERE id = ?')
        .run(row.corp_id);
    }
  }

  // Step 7: Resolve all action categories
  const currentPhase = db.prepare(
    'SELECT * FROM phases WHERE season_id = ? AND end_tick IS NULL ORDER BY phase_number ASC LIMIT 1'
  ).get(seasonId);

  resolveCombat(db, seasonId, tick, combatActions);
  resolveCovert(db, seasonId, tick, covertActions);
  resolveAlliances(db, seasonId, tick, allianceActions);
  resolveTrades(db, seasonId, tick, tradeActions);
  resolveSocial(db, seasonId, tick, socialActions, currentPhase ? currentPhase.id : null);

  // Mark all valid pending_actions as resolved
  for (const { row } of Object.values(validActions)) {
    db.prepare("UPDATE pending_actions SET status = 'resolved' WHERE id = ?").run(row.id);
  }

  // Step 9: Phase check
  checkPhase(db, seasonId, tick);
}

module.exports = { resolveActions };
