// src/api/routes/world.js — stub, replaced in Task 5
module.exports = function worldRoute(_conn) { // _conn used in Task 5 implementation
  return function (_req, res) {
    res.json({ type: 'world_state', tick: 0, districts: [], corporations: [], alliances: [], activeLaw: null, headlines: [] });
  };
};
