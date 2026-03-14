// src/index.js
// dotenv must load before any other require so DB_PATH etc. are available
require('dotenv').config();
const { initDb } = require('./db/schema');
const { createServer } = require('./api/server');
const { startTickLoop } = require('./game/tick');

async function main() {
  initDb();
  const app = createServer();
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Neon Syndicate running on port ${port}`));
  startTickLoop();
}

main().catch(console.error);
