/** Persistence: coins, bests, unlocks, settings. Safe if storage is blocked. */
const KEY = 'jungle-run-v1';

const DEFAULTS = {
  coins: 0,          // spendable wallet
  earned: 0,         // lifetime coins
  best: 0,           // best score
  bestDistance: 0,   // best meters
  runs: 0,
  totalDistance: 0,
  totalCoins: 0,
  idols: 0,
  selected: 'runner',
  unlocked: ['runner'],
  sound: true,
  music: true,
  quality: 'auto',
  tilt: false,
  seenIntro: false,
  zoneReached: 'jungle',
};

let data = { ...DEFAULTS };
let storageOk = true;

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) data = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (e) {
    storageOk = false;
  }
  return data;
}

export function save() {
  if (!storageOk) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    storageOk = false;
  }
}

export function get() { return data; }

export function set(k, v) { data[k] = v; save(); }

export function patch(obj) { Object.assign(data, obj); save(); }

export function addCoins(n) {
  data.coins += n; data.earned += n; save();
}

export function spendCoins(n) {
  if (data.coins < n) return false;
  data.coins -= n; save();
  return true;
}

export function unlock(id) { if (!data.unlocked.includes(id)) { data.unlocked.push(id); save(); } }

export function isUnlocked(id) { return data.unlocked.includes(id); }

export function resetAll() { data = { ...DEFAULTS }; save(); }
