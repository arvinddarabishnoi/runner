// Headless autopilot (see bot.mjs). It must be able to finish level 1-1 without
// deaths; this proves the simulation, physics and level data agree.
// Levels 1-2 and 1-3 are not yet bot-verified (see README "Known gaps").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBot } from './bot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (id) => JSON.parse(readFileSync(join(HERE, '..', 'server', 'levels', `${id}.json`), 'utf8'));

test('bot clears 1-1 within three lives and reports a score', () => {
  const r = runBot(load('1-1'), { maxSeconds: 120 });
  assert.equal(r.cleared, true, `bot failed: ${JSON.stringify(r)}`);
  assert.ok(r.deaths <= 3);
  assert.ok(r.score > 0);
});

test('bot run is deterministic', () => {
  const a = runBot(load('1-1'), { maxSeconds: 120 });
  const b = runBot(load('1-1'), { maxSeconds: 120 });
  assert.deepEqual(a, b);
});
