// src/index.js
// dotenv must load before any other require so DB_PATH etc. are available
require('dotenv').config();
const { initDb } = require('./db/schema');
const { createServer } = require('./api/server');
const { startTickLoop } = require('./game/tick');
const logger = require('./lib/logger');

async function main() {
  initDb();
  const { httpServer } = createServer();
  const port = process.env.PORT || 3000;
  httpServer.listen(port, () => logger.info('server', 'Neon Syndicate started', { port }));
  startTickLoop();
}

main().catch(err => logger.error('server', 'fatal startup error', { err: err.message, stack: err.stack }));
