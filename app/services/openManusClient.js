'use strict';

const DEFAULT_TIMEOUT_MS = 15_000;

function configuration() {
  return {
    baseUrl: String(process.env.OPENMANUS_ENGINE_URL || 'http://127.0.0.1:8010').replace(/\/$/, ''),
    token: String(process.env.OPENMANUS_SERVICE_TOKEN || ''),
    timeoutMs: Math.max(1_000, Number(process.env.OPENMANUS_REQUEST_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS)
  };
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const config = configuration();
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (config.token) headers.authorization = `Bearer ${config.token}`;

  let response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: combinedSignal
    });
  } catch (error) {
    const wrapped = new Error(`Motore OpenManus non raggiungibile: ${error.message}`);
    wrapped.code = error.name === 'TimeoutError' ? 'OPENMANUS_TIMEOUT' : 'OPENMANUS_UNAVAILABLE';
    wrapped.cause = error;
    throw wrapped;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.detail || payload.error || `OpenManus HTTP ${response.status}`);
    error.code = `OPENMANUS_HTTP_${response.status}`;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function health(options) {
  return request('/health', options);
}

function createTask({ prompt, metadata = {} }, options) {
  return request('/v1/tasks', { ...options, method: 'POST', body: { prompt, metadata } });
}

function getTask(taskId, options) {
  return request(`/v1/tasks/${encodeURIComponent(taskId)}`, options);
}

function cancelTask(taskId, options) {
  return request(`/v1/tasks/${encodeURIComponent(taskId)}/cancel`, { ...options, method: 'POST' });
}

async function waitForTask(taskId, { intervalMs = 1_000, timeoutMs = 30 * 60_000, signal, onUpdate } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw Object.assign(new Error('Task annullato'), { code: 'TASK_CANCELLED' });
    const task = await getTask(taskId, { signal });
    await onUpdate?.(task);
    if (['completed', 'failed', 'cancelled'].includes(task.status)) return task;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, intervalMs);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('Task annullato'), { code: 'TASK_CANCELLED' }));
      }, { once: true });
    });
  }
  throw Object.assign(new Error('OpenManus ha superato il tempo massimo'), { code: 'OPENMANUS_TASK_TIMEOUT' });
}

async function runTask({ prompt, metadata, signal, onUpdate } = {}) {
  const created = await createTask({ prompt, metadata }, { signal });
  const completed = await waitForTask(created.id, { signal, onUpdate });
  if (completed.status === 'failed') throw Object.assign(new Error(completed.error || 'OpenManus task failed'), { code: 'OPENMANUS_TASK_FAILED', taskId: completed.id });
  if (completed.status === 'cancelled') throw Object.assign(new Error('OpenManus task cancelled'), { code: 'TASK_CANCELLED', taskId: completed.id });
  return completed;
}

module.exports = { configuration, request, health, createTask, getTask, cancelTask, waitForTask, runTask };
