// src/api/ws.js
const WebSocket = require('ws');

let _wss = null;

function createWsServer(httpServer) {
  _wss = new WebSocket.Server({ server: httpServer, path: '/ws' });
  _wss.on('connection', (socket) => {
    socket.on('error', () => {}); // swallow client errors — don't crash server
  });
  return _wss;
}

function broadcast(message) {
  if (!_wss) return;
  const text = JSON.stringify(message);
  for (const client of _wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(text);
      } catch (err) {
        console.warn('[ws] broadcast send error:', err.message);
      }
    }
  }
}

module.exports = { createWsServer, broadcast };
