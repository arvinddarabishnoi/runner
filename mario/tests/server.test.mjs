// API contract tests. Each test run gets its own temp database file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
let dir, server, base;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'jump-hero-'));
  server = createApp({ dataFile: join(dir, 'db.json'), levelsDir: join(ROOT, 'server', 'levels'), staticRoot: ROOT });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text, headers: res.headers };
};

const run = (overrides = {}) => ({
  name: 'Ravi', level: '1-1', score: 1200, coins: 7, time: 42.5, cleared: true, ...overrides,
});

test('health reports the number of loaded levels', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, levels: 3 });
});

test('level list is public metadata only, in campaign order', async () => {
  const r = await call('GET', '/api/levels');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((l) => l.id), ['1-1', '1-2', '1-3']);
  for (const l of r.body) {
    assert.ok(l.name && l.timeLimit > 0 && l.width > 0 && l.height > 0);
    assert.equal(l.rows, undefined, 'map rows must not be in the list');
  }
});

test('single level returns the full map; unknown ids 404', async () => {
  const ok = await call('GET', '/api/levels/1-2');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.id, '1-2');
  assert.equal(ok.body.rows.length, 12);
  const miss = await call('GET', '/api/levels/9-9');
  assert.equal(miss.status, 404);
});

test('leaderboard requires a known level and starts empty', async () => {
  assert.equal((await call('GET', '/api/leaderboard?level=nope')).status, 404);
  const r = await call('GET', '/api/leaderboard?level=1-3');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, []);
});

test('a cleared run is ranked, unlocks the next level and appears on the board', async () => {
  const r = await call('POST', '/api/scores', run());
  assert.equal(r.status, 201);
  assert.equal(r.body.rank, 1);
  assert.equal(r.body.best, 1200);
  assert.equal(r.body.unlocked, 2);

  const board = await call('GET', '/api/leaderboard?level=1-1');
  assert.equal(board.body.length, 1);
  assert.equal(board.body[0].name, 'Ravi');
  assert.equal(board.body[0].score, 1200);
});

test('a lost run is recorded but does not unlock anything', async () => {
  const r = await call('POST', '/api/scores', run({ name: 'Asha', level: '1-2', score: 300, cleared: false }));
  assert.equal(r.status, 201);
  assert.equal(r.body.unlocked, 1);
  const p = await call('GET', '/api/players/Asha');
  assert.equal(p.body.unlocked, 1);
  assert.equal(p.body.best['1-2'], 300);
});

test('leaderboard is sorted by score, highest first', async () => {
  await call('POST', '/api/scores', run({ name: 'Bob', score: 5000 }));
  await call('POST', '/api/scores', run({ name: 'Cy', score: 2500 }));
  const board = await call('GET', '/api/leaderboard?level=1-1');
  assert.deepEqual(board.body.map((r) => r.name), ['Bob', 'Cy', 'Ravi']);
});

test('player progress is unlocked by clearing levels in order', async () => {
  await call('POST', '/api/scores', run({ name: 'Dee', level: '1-2', score: 900 }));
  const p = await call('GET', '/api/players/Dee');
  assert.equal(p.body.unlocked, 3);
  assert.equal(p.body.best['1-2'], 900);
  const fresh = await call('GET', '/api/players/Nobody');
  assert.deepEqual(fresh.body, { name: 'Nobody', unlocked: 1, best: {} });
});

test('invalid scores are rejected with 400', async () => {
  const bad = [
    run({ name: '' }),
    run({ name: 'x'.repeat(17) }),
    run({ name: '<script>' }),
    run({ level: 'nope' }),
    run({ score: -1 }),
    run({ score: 1000000 }),
    run({ score: 1.5 }),
    run({ coins: 10000 }),
    run({ time: 9999 }),
    run({ time: -3 }),
    run({ cleared: 'yes' }),
  ];
  for (const body of bad) {
    const r = await call('POST', '/api/scores', body);
    assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }
});

test('malformed JSON is a 400, not a crash', async () => {
  const res = await fetch(`${base}/api/scores`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
  assert.equal(res.status, 400);
});

test('unknown API routes and methods are a 404', async () => {
  assert.equal((await call('GET', '/api/unknown')).status, 404);
  assert.equal((await call('DELETE', '/api/scores')).status, 404);
});

test('static: serves the client, never the server code or data', async () => {
  const idx = await call('GET', '/');
  assert.equal(idx.status, 200);
  assert.match(idx.text, /<canvas id="game"/);
  assert.equal((await call('GET', '/js/game.js')).status, 200);
  assert.equal((await call('GET', '/css/style.css')).status, 200);
  assert.equal((await call('GET', '/server/index.mjs')).status, 404);
  assert.equal((await call('GET', '/tests/server.test.mjs')).status, 404);
  assert.equal((await call('GET', '/package.json')).status, 404);
  assert.equal((await call('GET', '/js/../package.json')).status, 404);
});
