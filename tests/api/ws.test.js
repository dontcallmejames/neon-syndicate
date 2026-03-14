// tests/api/ws.test.js
const http = require('http');
const WebSocket = require('ws');

// Helper: start a server on a random free port
function makeServer() {
  return new Promise(resolve => {
    const server = http.createServer();
    server.listen(0, () => resolve(server));
  });
}

// Helper: open a WebSocket client to the server's /ws path
function wsConnect(server) {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

// Helper: close a server
function closeServer(server) {
  return new Promise(resolve => server.close(resolve));
}

test('broadcast() before createWsServer is called — no-op, no throw', () => {
  // Use isolateModules to get a fresh module with _wss = null
  jest.isolateModules(() => {
    const { broadcast } = require('../../src/api/ws');
    expect(() => broadcast({ type: 'test' })).not.toThrow();
  });
});

test('broadcast() with no connected clients — no-op, no throw', async () => {
  const { createWsServer, broadcast } = require('../../src/api/ws');
  const server = await makeServer();
  createWsServer(server);
  expect(() => broadcast({ type: 'test' })).not.toThrow();
  await closeServer(server);
});

test('broadcast() sends JSON message to one connected client', async () => {
  const { createWsServer, broadcast } = require('../../src/api/ws');
  const server = await makeServer();
  createWsServer(server);
  const client = await wsConnect(server);

  const received = await new Promise(resolve => {
    client.once('message', data => resolve(JSON.parse(data)));
    broadcast({ type: 'tick_complete', tick: 1 });
  });

  expect(received).toEqual({ type: 'tick_complete', tick: 1 });
  client.close();
  await closeServer(server);
});

test('broadcast() sends to all connected clients', async () => {
  const { createWsServer, broadcast } = require('../../src/api/ws');
  const server = await makeServer();
  createWsServer(server);
  const [client1, client2] = await Promise.all([wsConnect(server), wsConnect(server)]);

  const p1 = new Promise(resolve => client1.once('message', d => resolve(JSON.parse(d))));
  const p2 = new Promise(resolve => client2.once('message', d => resolve(JSON.parse(d))));
  broadcast({ type: 'multi' });
  const [msg1, msg2] = await Promise.all([p1, p2]);

  expect(msg1).toEqual({ type: 'multi' });
  expect(msg2).toEqual({ type: 'multi' });
  client1.close();
  client2.close();
  await closeServer(server);
});

test('closed client does not prevent other clients from receiving', async () => {
  const { createWsServer, broadcast } = require('../../src/api/ws');
  const server = await makeServer();
  createWsServer(server);
  const [client1, client2] = await Promise.all([wsConnect(server), wsConnect(server)]);

  // Close client1 and wait for the server to notice
  client1.close();
  await new Promise(r => setTimeout(r, 50));

  const p2 = new Promise(resolve => client2.once('message', d => resolve(JSON.parse(d))));
  broadcast({ type: 'after-close' });
  const msg = await p2;

  expect(msg).toEqual({ type: 'after-close' });
  client2.close();
  await closeServer(server);
});
