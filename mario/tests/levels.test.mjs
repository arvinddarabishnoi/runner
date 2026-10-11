// Level data checks: the shipped campaign must be valid and fair on the static rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLevels, validateLevel } from '../server/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LEVEL_DIR = join(HERE, '..', 'server', 'levels');
const levels = loadLevels(LEVEL_DIR);
const MAX_PIT = 3; // tiles; a running hop clears ~5 tiles, so 3 leaves room for the landing

test('loadLevels finds all shipped levels, in order', () => {
  assert.deepEqual(readdirSync(LEVEL_DIR).filter((f) => f.endsWith('.json')).length, levels.length);
  assert.deepEqual(levels.map((l) => l.id), ['1-1', '1-2', '1-3']);
});

for (const lvl of levels) {
  test(`${lvl.id} ${lvl.name}: valid structure`, () => {
    assert.doesNotThrow(() => validateLevel(lvl, lvl.id));
    const flat = lvl.rows.join('');
    assert.equal((flat.match(/@/g) || []).length, 1, 'one spawn');
    const flags = [...flat].filter((c) => c === 'F').length;
    assert.ok(flags >= 1, 'flag present');
    // the spawn and flag must sit on the same screen-ish distance apart (not on top of each other)
    const spawn = flat.indexOf('@') % lvl.rows[0].length;
    assert.ok(spawn < 6, 'spawn near the left edge');
  });

  test(`${lvl.id} ${lvl.name}: flag pole is one column`, () => {
    const cols = new Set();
    lvl.rows.forEach((r) => [...r].forEach((c, x) => { if (c === 'F') cols.add(x); }));
    assert.equal(cols.size, 1);
  });

  test(`${lvl.id} ${lvl.name}: every floor gap is jumpable`, () => {
    const floor = lvl.rows[lvl.rows.length - 1];
    let start = -1;
    for (let x = 0; x <= floor.length; x++) {
      const open = x < floor.length && floor[x] !== '#';
      if (open && start < 0) start = x;
      if (!open && start >= 0) {
        const width = x - start;
        assert.ok(width <= MAX_PIT, `pit at columns ${start}-${x - 1} is ${width} tiles wide (max ${MAX_PIT})`);
        start = -1;
      }
    }
  });

  test(`${lvl.id} ${lvl.name}: no tall pipe sits within 6 tiles before a pit`, () => {
    // a 3-tile pipe needs a full hop; a pit that close leaves no room to land and jump again
    const rows = lvl.rows;
    const floorRow = rows.length - 2; // top row of the ground
    for (let x = 0; x < rows[0].length; x++) {
      if (rows[floorRow - 1][x] !== 'P' || rows[floorRow - 3][x] !== 'P') continue; // 3 tiles tall
      // scan 6 columns to the right for a pit in the floor
      for (let d = 1; d <= 6 && x + d < rows[0].length; d++) {
        const floorTile = rows[rows.length - 1][x + d];
        if (floorTile !== '#' && floorTile !== '=') {
          assert.fail(`tall pipe at column ${x} is followed by a pit at column ${x + d}`);
        }
      }
    }
  });
}

test('validateLevel rejects broken level data', () => {
  const good = JSON.parse(readFileSync(join(LEVEL_DIR, '1-1.json'), 'utf8'));
  assert.throws(() => validateLevel({ ...good, rows: [...good.rows, 'short'] }), /equal-length/);
  assert.throws(() => validateLevel({ ...good, id: undefined }), /missing id/);
  assert.throws(() => validateLevel({ ...good, timeLimit: 0 }), /timeLimit/);
  assert.throws(() => validateLevel({ ...good, rows: good.rows.map((r) => r.replace('F', '.')) }), /flag/);
  assert.throws(() => validateLevel({ ...good, rows: good.rows.map((r) => r.replace('@', '.')) }), /spawn/);
  assert.throws(() => validateLevel({ ...good, rows: good.rows.map((r, i) => (i === 0 ? r.slice(1) + '!' : r)) }), /unknown tile|equal-length/);
});
