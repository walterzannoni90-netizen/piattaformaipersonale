function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '').slice(0, 20);
}

function validPhone(value) {
  const normalized = normalizePhone(value);
  return normalized.length >= 7 && normalized.length <= 20;
}

module.exports = { normalizePhone, validPhone };
