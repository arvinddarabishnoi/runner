/**
 * Zero-dependency static server for Jungle Run.
 *
 *   node tools/serve.mjs [port]
 *
 * Serves the repo root with correct MIME types, no caching and no host
 * restrictions (works behind the sandbox preview proxy).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  try {
    const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = decodeURIComponent(parsed.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filePath = path.join(root, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end(`404 ${pathname}`);
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'content-length': stat.size,
        'cache-control': 'no-cache, no-store, must-revalidate',
        // allow embedding in the preview iframe / any origin
        'access-control-allow-origin': '*',
      });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end('server error');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Jungle Run is live on http://0.0.0.0:${port}  (serving ${root})`);
});
