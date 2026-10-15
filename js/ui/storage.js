// Preferências e estatísticas salvas localmente (localStorage).

const KEY_PREFS = 'damas-ia:prefs:v1';
const KEY_STATS = 'damas-ia:stats:v1';

export const DEFAULT_PREFS = {
  level: 'impossivel',
  color: 1,
  training: false,
  clock: false,
  sound: true,
};

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* armazenamento indisponível (modo privado): segue sem salvar */
  }
}

export function loadPrefs() {
  return { ...DEFAULT_PREFS, ...(read(KEY_PREFS) || {}) };
}

export function savePrefs(p) {
  write(KEY_PREFS, p);
}

export function loadStats() {
  const s = read(KEY_STATS);
  return s && typeof s === 'object' ? s : {};
}

export function saveStats(s) {
  write(KEY_STATS, s);
}
