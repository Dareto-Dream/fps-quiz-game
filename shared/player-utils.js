(function exposePlayerUtils(root) {
  const MAX_PLAYER_NAME_LENGTH = 18;

  function sanitizePlayerName(value, fallback = '') {
    const normalized = String(value || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const truncated = Array.from(normalized).slice(0, MAX_PLAYER_NAME_LENGTH).join('').trim();
    return truncated || fallback;
  }

  const api = {
    MAX_PLAYER_NAME_LENGTH,
    sanitizePlayerName
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  root.ArenaPlayerUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
