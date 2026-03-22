// src/api/ws.js
const WebSocket = require('ws');
const logger = require('../lib/logger');

let _wss = null;

function createWsServer(httpServer) {
  _wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

  const heartbeat = setInterval(() => {
    _wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  _wss.on('close', () => clearInterval(heartbeat));

  _wss.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('error', () => {}); // swallow client errors — don't crash server
  });

  return _wss;
}

function broadcast(message) {
  if (!_wss) return;
  let text;
  try {
    text = JSON.stringify(message);
  } catch (err) {
    logger.warn('ws', 'broadcast serialize error', { err: err.message });
    return;
  }
  for (const client of _wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(text);
      } catch (err) {
        logger.warn('ws', 'broadcast send error', { err: err.message });
      }
    }
  }
}

module.exports = { createWsServer, broadcast };
