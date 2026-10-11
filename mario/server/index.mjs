// Jump Hero — HTTP server: serves the game client and a small JSON API.
//   GET  /api/health
//   GET  /api/levels               campaign list (no map data)
//   GET  /api/levels/:id           full level including ASCII rows
//   GET  /api/leaderboard?level=   top 10 for a level
//   POST /api/scores               submit a finished run
//   GET  /api/players/:name        progress (unlocked levels) + personal bests
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname, normalize, dirname, resolve, sep } from 'node:path';
import { Store } from './store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ogg': 'audio/ogg', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.ico': 'image/x-icon',
};
const NAME_RE = /^[A-Za-z0-9 _-]{1,16}$/;
const MAX_BODY = 8 * 1024;
const MAX_SCORE = 999_999;

export function loadLevels(dir = join(HERE, 'levels')) {
  const levels = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    validateLevel(data, f);
    return data;
  });
  if (levels.length === 0) throw new Error(`No levels found in ${dir}`);
  const ids = new Set(levels.map((l) => l.id));
  if (ids.size !== levels.length) throw new Error('Duplicate level ids');
  return levels;
}

export function validateLevel(data, source = 'level') {
  const fail = (m) => { throw new Error(`${source}: ${m}`); };
  if (!data || typeof data.id !== 'string') fail('missing id');
  if (typeof data.name !== 'string') fail('missing name');
  if (!Array.isArray(data.rows) || data.rows.length === 0) fail('missing rows');
  const w = data.rows[0].length;
  if (data.rows.some((r) => typeof r !== 'string' || r.length !== w)) fail('rows must be equal-length strings');
  if (!(data.timeLimit > 0)) fail('timeLimit must be positive');
  const flat = data.rows.join('');
  if ((flat.match(/@/g) || []).length !== 1) fail('exactly one @ spawn required');
  if (!flat.includes('F')) fail('needs a flag (F)');
  if (/[^.#=B?MxPwofenF@]/.test(flat)) fail('unknown tile character');
  return data;
}

function publicLevel(l) {
  return { id: l.id, name: l.name, theme: l.theme ?? 'grass', timeLimit: l.timeLimit, width: l.rows[0].length, height: l.rows.length };
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' || Buffer.isBuffer(body) ? headers['Content-Type'] ?? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(httpError(413, 'payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(httpError(400, 'invalid JSON')); }
    });
    req.on('error', reject);
  });
}

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const httpError = (s, m) => new HttpError(s, m);

export function validateScore(body, levels) {
  const level = levels.find((l) => l.id === body.level);
  if (!level) throw httpError(400, 'unknown level');
  if (typeof body.name !== 'string' || !NAME_RE.test(body.name.trim())) throw httpError(400, 'name must be 1-16 letters, digits, space, _ or -');
  const isInt = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
  if (!isInt(body.score, MAX_SCORE)) throw httpError(400, 'bad score');
  if (!isInt(body.coins, 9999)) throw httpError(400, 'bad coins');
  if (typeof body.time !== 'number' || !(body.time >= 0) || body.time > level.timeLimit) throw httpError(400, 'bad time');
  if (typeof body.cleared !== 'boolean') throw httpError(400, 'cleared must be boolean');
  return { name: body.name.trim(), level: level.id, levelIndex: levels.indexOf(level), score: body.score,
    coins: body.coins, time: Math.round(body.time * 10) / 10, cleared: body.cleared };
}

export function createApp({ dataFile, levelsDir, staticRoot = ROOT } = {}) {
  const levels = loadLevels(levelsDir);
  const store = new Store(dataFile);

  async function handleApi(req, res, url) {
    const path = url.pathname;
    if (req.method === 'GET' && path === '/api/health') return send(res, 200, { ok: true, levels: levels.length });
    if (req.method === 'GET' && path === '/api/levels') return send(res, 200, levels.map(publicLevel));
    const m = path.match(/^\/api\/levels\/([^/]+)$/);
    if (req.method === 'GET' && m) {
      const level = levels.find((l) => l.id === decodeURIComponent(m[1]));
      return level ? send(res, 200, level) : send(res, 404, { error: 'level not found' });
    }
    if (req.method === 'GET' && path === '/api/leaderboard') {
      const level = url.searchParams.get('level');
      if (!levels.some((l) => l.id === level)) return send(res, 404, { error: 'level not found' });
      return send(res, 200, store.leaderboard(level));
    }
    if (req.method === 'POST' && path === '/api/scores') {
      const entry = validateScore(await readJson(req), levels);
      const result = store.addScore({ ...entry, levelCount: levels.length });
      return send(res, 201, result);
    }
    const p = path.match(/^\/api\/players\/([^/]+)$/);
    if (req.method === 'GET' && p) {
      const name = decodeURIComponent(p[1]);
      if (!NAME_RE.test(name)) throw httpError(400, 'bad name');
      const player = store.getPlayer(name);
      const best = {};
      for (const s of store.db.scores) if (s.name === name) best[s.level] = Math.max(best[s.level] ?? 0, s.score);
      return send(res, 200, { name, unlocked: player.unlocked, best });
    }
    return send(res, 404, { error: 'not found' });
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    // only the client bundle is public: never the server code, tests or database
    if (!/^\/(index\.html|css\/|js\/|assets\/)/.test(rel)) return send(res, 404, 'Not found');
    const file = normalize(join(staticRoot, rel));
    if (!file.startsWith(resolve(staticRoot) + sep) || !existsSync(file) || !statSync(file).isFile()) {
      return send(res, 404, 'Not found');
    }
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(readFileSync(file));
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        serveStatic(req, res, url);
      } else {
        send(res, 405, { error: 'method not allowed' });
      }
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'server error' : err.message });
    }
  });
  server.store = store;
  server.levels = levels;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4174);
  const dataFile = process.env.MARIO_DATA ?? join(HERE, 'data', 'db.json');
  const server = createApp({ dataFile });
  server.listen(port, '0.0.0.0', () => {
    console.log(`Jump Hero running on http://0.0.0.0:${port}  (${server.levels.length} levels, data: ${dataFile})`);
  });
}
