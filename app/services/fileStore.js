const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.AGENT_WORKSPACE_ROOT || path.join(__dirname, '../../data/workspaces'));
const maxFileBytes = Number(process.env.AGENT_MAX_FILE_BYTES || 10 * 1024 * 1024);
const allowedMimeTypes = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'application/csv',
  'application/json', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png', 'image/jpeg', 'image/webp'
]);

const extensionsByMime = new Map([
  ['text/plain', new Set(['.txt'])],
  ['text/markdown', new Set(['.md'])],
  ['text/csv', new Set(['.csv', '.tsv'])],
  ['application/csv', new Set(['.csv'])],
  ['application/json', new Set(['.json'])],
  ['application/pdf', new Set(['.pdf'])],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', new Set(['.docx'])],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', new Set(['.xlsx'])],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', new Set(['.pptx'])],
  ['image/png', new Set(['.png'])],
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
  ['image/webp', new Set(['.webp'])]
]);

function ensureInsideRoot(target) {
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Percorso workspace non valido');
  }
  return resolved;
}

function safeSegment(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

function extensionFor(name) {
  const extension = path.extname(String(name || '')).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '';
}

function taskDirectory(userId, taskId) {
  const target = ensureInsideRoot(path.join(root, safeSegment(userId), safeSegment(taskId)));
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  return target;
}

function validateUpload(file) {
  if (!file?.buffer || !file.originalname) throw new Error('File mancante');
  const byteLength = file.buffer.length;
  if (!byteLength || byteLength > maxFileBytes) {
    throw new Error(`File vuoto o troppo grande. Limite: ${Math.floor(maxFileBytes / 1024 / 1024)} MB`);
  }
  if (!allowedMimeTypes.has(file.mimetype)) throw new Error('Tipo di file non consentito');
  const extension = extensionFor(file.originalname);
  if (!extensionsByMime.get(file.mimetype)?.has(extension)) throw new Error('Estensione e tipo del file non corrispondono');
  const bytes = file.buffer;
  const starts = (...values) => values.every((value, index) => bytes[index] === value);
  const isOffice = file.mimetype.startsWith('application/vnd.openxmlformats-officedocument.');
  if (file.mimetype === 'application/pdf' && bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Firma PDF non valida');
  if (isOffice && !(starts(0x50, 0x4b, 0x03, 0x04) || starts(0x50, 0x4b, 0x05, 0x06))) throw new Error('Firma documento Office non valida');
  if (file.mimetype === 'image/png' && !starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) throw new Error('Firma PNG non valida');
  if (file.mimetype === 'image/jpeg' && !starts(0xff, 0xd8, 0xff)) throw new Error('Firma JPEG non valida');
  if (file.mimetype === 'image/webp' && !(bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')) throw new Error('Firma WebP non valida');
  if ((file.mimetype.startsWith('text/') || file.mimetype === 'application/json') && bytes.subarray(0, 8192).includes(0)) throw new Error('Il file testuale contiene dati binari');
  return true;
}

function ensureInsideTask(userId, taskId, target) {
  const directory = taskDirectory(userId, taskId);
  const resolved = ensureInsideRoot(target);
  if (resolved !== directory && !resolved.startsWith(`${directory}${path.sep}`)) {
    throw new Error('File fuori dal task corrente');
  }
  return resolved;
}

function saveUpload({ userId, taskId, file }) {
  validateUpload(file);

  const directory = taskDirectory(userId, taskId);
  const storedName = `${crypto.randomUUID()}${extensionFor(file.originalname)}`;
  const storagePath = ensureInsideRoot(path.join(directory, storedName));
  fs.writeFileSync(storagePath, file.buffer, { mode: 0o600, flag: 'wx' });
  return {
    storedName,
    storagePath,
    sha256: crypto.createHash('sha256').update(file.buffer).digest('hex')
  };
}

function saveArtifact({ userId, taskId, name, content }) {
  const directory = taskDirectory(userId, taskId);
  const storedName = `${crypto.randomUUID()}${extensionFor(name) || '.md'}`;
  const storagePath = ensureInsideRoot(path.join(directory, storedName));
  const payload = Buffer.isBuffer(content) || content instanceof Uint8Array ? content : Buffer.from(String(content), 'utf8');
  fs.writeFileSync(storagePath, payload, { mode: 0o600, flag: 'wx' });
  return { storedName, storagePath };
}

function readFile(storagePath) {
  return fs.readFileSync(ensureInsideRoot(storagePath));
}

function removeFile(storagePath) {
  const target = ensureInsideRoot(storagePath);
  if (fs.existsSync(target)) fs.unlinkSync(target);
}

module.exports = {
  root,
  maxFileBytes,
  allowedMimeTypes,
  validateUpload,
  taskDirectory,
  saveUpload,
  saveArtifact,
  readFile,
  removeFile,
  ensureInsideRoot,
  ensureInsideTask
};
