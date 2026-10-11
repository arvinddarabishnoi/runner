/**
 * Re-vendors three.js into vendor/ from node_modules (run after `npm install`).
 * Only the post-processing passes the render pipeline actually needs are
 * copied, so the bundle stays small.
 *
 *   npm install three && npm run vendor
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', 'three');
const out = path.join(root, 'vendor');

if (!fs.existsSync(src)) {
  console.error('three is not installed — run `npm install` first.');
  process.exit(1);
}

const version = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).version;
fs.mkdirSync(out, { recursive: true });

for (const file of ['build/three.module.js', 'build/three.core.js']) {
  fs.copyFileSync(path.join(src, file), path.join(out, path.basename(file)));
}

const ENTRIES = [
  'examples/jsm/postprocessing/EffectComposer.js',
  'examples/jsm/postprocessing/RenderPass.js',
  'examples/jsm/postprocessing/UnrealBloomPass.js',
  'examples/jsm/postprocessing/OutputPass.js',
];

fs.rmSync(path.join(out, 'addons'), { recursive: true, force: true });
const seen = new Set();
const queue = [...ENTRIES];
while (queue.length) {
  const rel = queue.pop();
  if (seen.has(rel)) continue;
  seen.add(rel);
  const from = path.join(src, rel);
  const to = path.join(out, 'addons', rel.replace(/^examples\/jsm\//, ''));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  const source = fs.readFileSync(from, 'utf8');
  for (const m of source.matchAll(/from\s+'(\.[^']+)'/g)) {
    const dep = path.join(path.dirname(rel), m[1]);
    if (fs.existsSync(path.join(src, dep))) queue.push(dep);
    else console.warn(`  ! ${rel} imports missing ${m[1]}`);
  }
}

console.log(`vendored three r${version}: build + ${seen.size} addon modules → vendor/`);
