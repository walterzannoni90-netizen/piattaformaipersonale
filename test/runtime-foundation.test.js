'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolRegistry, createDefaultRegistry } = require('../app/services/toolRegistry');
const { validateBrowserCommand, requiresBrowserApproval, browserApprovalHash } = require('../app/services/browserPolicy');

test('tool registry denies unknown tools and disallowed agents', () => {
  const registry = createDefaultRegistry();
  assert.deepEqual(registry.authorize({ toolId: 'missing', action: 'read', plan: 'pro', agentRole: 'scout' }), {
    allowed: false, reason: 'tool_not_registered', tool: null
  });
  const denied = registry.authorize({
    toolId: 'browser.session', action: 'navigate', plan: 'starter', agentRole: 'scout', approvedPayloadHash: 'hash'
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'plan_not_allowed');
});

test('browser side effects require exact approval', () => {
  const registry = createDefaultRegistry();
  const denied = registry.authorize({
    toolId: 'browser.session', action: 'submit', plan: 'pro', agentRole: 'operator'
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'approval_required');

  const allowed = registry.authorize({
    toolId: 'browser.session', action: 'submit', plan: 'pro', agentRole: 'operator', approvedPayloadHash: 'abc'
  });
  assert.equal(allowed.allowed, true);
});

test('browser commands are normalized and unsafe inputs rejected', () => {
  assert.equal(validateBrowserCommand({ action: 'navigate', url: 'https://example.com/page#fragment' }).url, 'https://example.com/page');
  assert.equal(requiresBrowserApproval({ action: 'screenshot' }), false);
  assert.equal(requiresBrowserApproval({ action: 'download' }), true);
  assert.throws(() => validateBrowserCommand({ action: 'navigate', url: 'file:///etc/passwd' }), /Protocollo/);
  assert.throws(() => validateBrowserCommand({ action: 'upload', selector: '#file', filename: '../secret.txt' }), /Nome file/);
});

test('approval hash is stable and tenant scoped', () => {
  const command = { action: 'submit', selector: '#checkout', value: 'confirm' };
  const first = browserApprovalHash({ userId: 1, taskId: 2, command });
  const second = browserApprovalHash({ userId: 1, taskId: 2, command });
  const otherUser = browserApprovalHash({ userId: 9, taskId: 2, command });
  assert.equal(first, second);
  assert.notEqual(first, otherUser);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('registry rejects malformed definitions', () => {
  const registry = new ToolRegistry();
  assert.throws(() => registry.register({ id: 'X', actions: ['a'], plans: ['pro'], agentRoles: ['operator'] }), /ID/);
  assert.throws(() => registry.register({ id: 'valid.tool', actions: [], plans: ['pro'], agentRoles: ['operator'] }), /obbligatori/);
});
