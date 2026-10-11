// Tiny persistent store: keeps everything in memory and writes the whole
// database to a JSON file atomically (tmp file + rename) after each change.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_PER_LEVEL = 100;

export class Store {
  constructor(file) {
    this.file = file;
    this.db = { players: {}, scores: [] };
    if (file && existsSync(file)) {
      try {
        const loaded = JSON.parse(readFileSync(file, 'utf8'));
        this.db = { players: loaded.players ?? {}, scores: loaded.scores ?? [] };
      } catch (err) {
        throw new Error(`Could not read database ${file}: ${err.message}`);
      }
    }
    this.nextId = this.db.scores.reduce((m, s) => Math.max(m, s.id), 0) + 1;
    this.queue = Promise.resolve();
  }

  #persist() {
    if (!this.file) return;
    // serialise writes so concurrent requests never interleave on disk
    this.queue = this.queue.then(() => {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.db, null, 2));
      renameSync(tmp, this.file);
    }).catch((err) => console.error('[store] write failed:', err));
    return this.queue;
  }

  getPlayer(name) {
    return this.db.players[name] ?? { name, unlocked: 1 };
  }

  leaderboard(level, limit = 10) {
    return this.db.scores
      .filter((s) => s.level === level)
      .sort((a, b) => b.score - a.score || a.time - b.time || a.id - b.id)
      .slice(0, limit)
      .map(({ id, name, score, coins, time, at }) => ({ id, name, score, coins, time, at }));
  }

  /**
   * Record a finished run. `levelIndex` is the 0-based position of the level in
   * the campaign so we can unlock the next one when the level is cleared.
   */
  addScore({ name, level, levelIndex, levelCount, score, coins, time, cleared }) {
    const entry = { id: this.nextId++, name, level, score, coins, time, cleared, at: new Date().toISOString() };
    this.db.scores.push(entry);

    // keep the file small: only the best MAX_PER_LEVEL entries survive per level
    const same = this.db.scores.filter((s) => s.level === level)
      .sort((a, b) => b.score - a.score || a.time - b.time || a.id - b.id);
    if (same.length > MAX_PER_LEVEL) {
      const keep = new Set(same.slice(0, MAX_PER_LEVEL).map((s) => s.id));
      this.db.scores = this.db.scores.filter((s) => s.level !== level || keep.has(s.id));
    }

    const player = this.db.players[name] ?? { name, unlocked: 1 };
    if (cleared) player.unlocked = Math.min(levelCount, Math.max(player.unlocked, levelIndex + 2));
    this.db.players[name] = player;

    const ranked = this.leaderboard(level, MAX_PER_LEVEL);
    const rank = ranked.findIndex((s) => s.id === entry.id) + 1;
    const best = Math.max(0, ...this.db.scores.filter((s) => s.name === name && s.level === level).map((s) => s.score));
    this.#persist();
    return { rank: rank || null, best, unlocked: player.unlocked };
  }

  flush() { return this.queue; }
}
