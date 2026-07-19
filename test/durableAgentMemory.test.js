'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { DurableAgentMemory } = require('../app/services/durableAgentMemory');

async function temporaryMemory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-memory-'));
  return { directory, memory: new DurableAgentMemory({ directory, maxEvents: 100 }) };
}

test('saves, loads and versions durable state', async (t) => {
  const { directory, memory } = await temporaryMemory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const first = await memory.save('task-1', { status: 'running' }, [{ type: 'started' }]);
  const second = await memory.save('task-1', { status: 'completed' }, [{ type: 'completed' }]);
  const loaded = await memory.load('task-1');

  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal(loaded.state.status, 'completed');
});

test('appends events and resumes a checkpoint', async (t) => {
  const { directory, memory } = await temporaryMemory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await memory.appendEvent('task-2', { type: 'created' }, (state) => ({ ...state, created: true }));
  await memory.checkpoint('task-2', { status: 'running', progress: 0.5, graph: { id: 'g1' } });
  const restored = await memory.resume('task-2');
  const loaded = await memory.load('task-2');

  assert.equal(restored.graph.id, 'g1');
  assert.equal(loaded.events.length, 2);
  assert.equal(loaded.state.resumable, true);
});

test('detects tampered memory and rejects unsafe keys', async (t) => {
  const { directory, memory } = await temporaryMemory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await memory.save('safe-key', { status: 'running' });
  const file = path.join(directory, 'safe-key.json');
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  data.state.status = 'tampered';
  await fs.writeFile(file, JSON.stringify(data), 'utf8');

  await assert.rejects(() => memory.load('safe-key'), /corrotta/i);
  await assert.rejects(() => memory.save('../escape', {}), /non valida/i);
});
