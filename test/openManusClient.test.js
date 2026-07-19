'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const client = require('../app/services/openManusClient');

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const previousUrl = process.env.OPENMANUS_ENGINE_URL;
  const previousToken = process.env.OPENMANUS_SERVICE_TOKEN;
  process.env.OPENMANUS_ENGINE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.OPENMANUS_SERVICE_TOKEN = 'test-token';
  try { await run(); } finally {
    if (previousUrl === undefined) delete process.env.OPENMANUS_ENGINE_URL; else process.env.OPENMANUS_ENGINE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.OPENMANUS_SERVICE_TOKEN; else process.env.OPENMANUS_SERVICE_TOKEN = previousToken;
    await new Promise((resolve) => server.close(resolve));
  }
}

test('health calls engine with bearer authentication', async () => {
  await withServer((req, res) => {
    assert.equal(req.url, '/health');
    assert.equal(req.headers.authorization, 'Bearer test-token');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', engine: 'openmanus' }));
  }, async () => {
    const result = await client.health();
    assert.equal(result.engine, 'openmanus');
  });
});

test('runTask submits and polls until completion', async () => {
  let polls = 0;
  await withServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.url === '/v1/tasks') return res.end(JSON.stringify({ id: 'task-1', status: 'queued' }));
    if (req.method === 'GET' && req.url === '/v1/tasks/task-1') {
      polls += 1;
      return res.end(JSON.stringify(polls > 1 ? { id: 'task-1', status: 'completed', result: 'done' } : { id: 'task-1', status: 'running' }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ detail: 'not found' }));
  }, async () => {
    const updates = [];
    const created = await client.createTask({ prompt: 'esegui un compito autonomo completo' });
    const result = await client.waitForTask(created.id, { intervalMs: 5, timeoutMs: 1000, onUpdate: (state) => updates.push(state.status) });
    assert.equal(result.result, 'done');
    assert.deepEqual(updates, ['running', 'completed']);
  });
});

test('HTTP failures expose stable error codes', async () => {
  await withServer((req, res) => {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ detail: 'Unauthorized' }));
  }, async () => {
    await assert.rejects(client.createTask({ prompt: 'esegui un compito autonomo completo' }), (error) => error.code === 'OPENMANUS_HTTP_401');
  });
});
