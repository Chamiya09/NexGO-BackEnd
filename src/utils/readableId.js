const buildReadableId = (prefix, id) => {
  const raw = id?.toString?.() || '';
  if (!raw) return '';

  return `${prefix}-${raw.slice(-6).toUpperCase()}`;
};

module.exports = { buildReadableId };
