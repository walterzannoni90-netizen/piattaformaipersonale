const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fileStore = require('./fileStore');

const workerPath = path.resolve(__dirname, '../workers/python_sandbox.py');

function runPythonOperation({ userId, taskId, operation, payload = {}, timeoutMs = 15_000 }) {
  const workspace = fileStore.taskDirectory(userId, taskId);
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON_BIN || 'python3', ['-I', '-X', 'utf8', workerPath], {
      cwd: workspace,
      env: {
        PATH: process.env.PATH || '/usr/bin:/bin',
        PYTHONIOENCODING: 'utf-8',
        AGENT_WORK_ROOT: fileStore.root
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new Error('Operazione Python scaduta'));
    }, Math.min(Math.max(timeoutMs, 1000), 30_000));
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 2_000_000) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(0, 20_000); });
    child.stdin.on('error', () => {});
    child.on('error', (error) => finish(reject, error));
    child.on('close', (code) => {
      try {
        const result = JSON.parse(stdout.trim() || '{}');
        if (code !== 0 || !result.success) throw new Error(result.error || stderr || 'Errore worker Python');
        finish(resolve, result);
      } catch (error) {
        finish(reject, error);
      }
    });
    child.stdin.end(JSON.stringify({ workspace, operation, payload }));
  });
}

function checkPythonRuntime() {
  const binary = process.env.PYTHON_BIN || 'python3';
  const probe = spawnSync(binary, ['-I', '-X', 'utf8', '-c', 'import openpyxl, PIL, pypdf, docx, pptx, reportlab; print("ready")'], {
    env: { PATH: process.env.PATH || '/usr/bin:/bin', PYTHONIOENCODING: 'utf-8' },
    encoding: 'utf8', timeout: 10_000, maxBuffer: 64_000
  });
  return {
    ready: probe.status === 0 && probe.stdout.trim() === 'ready',
    binary,
    error: probe.status === 0 ? null : String(probe.stderr || probe.error?.message || 'Runtime Python non disponibile').trim().slice(0, 500)
  };
}

module.exports = { runPythonOperation, checkPythonRuntime };
