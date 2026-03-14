// src/api/routes/world.js — stub, replaced in Task 5
module.exports = function worldRoute(_conn) {
  return function (_req, res) {
    res.json({ type: 'world_state', tick: 0, districts: [], corporations: [], alliances: [], activeLaw: null, headlines: [] });
  };
};
