/**
 * Static consistency checks — the cheapest possible "browser":
 *  - every element id referenced from JS exists in index.html
 *  - every asset path referenced anywhere exists on disk
 *  - every relative import resolves, and bare "three" imports match the
 *    import map in index.html
 *
 *   node tools/check_wiring.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

const html = read('index.html');
const problems = [];
const notes = [];

// ---------------------------------------------------------------- html ids
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

// --------------------------------------------------------------- js files
const jsFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel);
    else if (entry.name.endsWith('.js')) jsFiles.push(rel);
  }
};
walk('js');
walk('vendor/addons');

for (const file of jsFiles) {
  const src = read(file);
  // vendored addons only need their imports to resolve
  if (file.startsWith('vendor/')) {
    for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
      if (!exists(path.join(path.dirname(file), m[1]))) {
        problems.push(`${file}: import '${m[1]}' does not exist`);
      }
    }
    continue;
  }

  // element lookups: $('x'), getElementById('x'), querySelector('#x')
  const lookups = [
    ...src.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g),
    ...src.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g),
    ...src.matchAll(/querySelector\('#([A-Za-z0-9_-]+)'\)/g),
  ];
  for (const m of lookups) {
    if (!htmlIds.has(m[1])) problems.push(`${file}: looks up #${m[1]} which is not in index.html`);
  }
  // relative imports must resolve on disk
  for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
    const resolved = path.join(path.dirname(file), m[1]);
    if (!exists(resolved)) problems.push(`${file}: import '${m[1]}' does not exist`);
  }
  // asset string literals
  for (const m of src.matchAll(/'(assets\/[^']+)'/g)) {
    if (!exists(m[1])) problems.push(`${file}: references missing asset ${m[1]}`);
  }
}

// ------------------------------------------------------------- html assets
for (const m of html.matchAll(/(?:src|href)="((?!http|#|data:)[^"]+)"/g)) {
  const p = m[1].replace(/^\.\//, '');
  if (p.endsWith('.js') || p.endsWith('.css') || p.startsWith('assets/')) {
    if (!exists(p)) problems.push(`index.html: missing file ${p}`);
  }
}

// -------------------------------------------------------------- css assets
const css = read('css/style.css');
for (const m of css.matchAll(/url\('([^']+)'\)/g)) {
  const p = m[1].replace(/^\.\.\//, '');
  if (!exists(p)) problems.push(`css/style.css: missing ${p}`);
}

// ------------------------------------------------------------ import map
const mapMatch = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
if (!mapMatch) {
  problems.push('index.html: import map is missing (bare "three" imports would fail)');
} else {
  const map = JSON.parse(mapMatch[1]).imports || {};
  const targets = [...jsFiles, ...['tools/headless_test.mjs', 'tools/scene_test.mjs']]
    .flatMap((f) => [...read(f).matchAll(/from\s+'(three[^']*)'/g)].map((m) => m[1]));
  for (const spec of new Set(targets)) {
    if (spec === 'three') {
      if (!map.three) problems.push('import map has no "three" entry');
    } else {
      const prefix = spec.split('/').slice(0, 2).join('/') + '/';
      if (!map[prefix]) problems.push(`import map has no entry for "${prefix}" (needed by ${spec})`);
    }
  }
  notes.push(`import map covers: ${Object.keys(map).join(', ')}`);
}

// --------------------------------------------------------------- reporting
notes.push(`${jsFiles.length} js modules scanned, ${htmlIds.size} html ids found`);
console.log('\n=== wiring check ===');
notes.forEach((n) => console.log('  · ' + n));
if (problems.length) {
  console.log('\nPROBLEMS:');
  problems.forEach((p) => console.log('  ✗ ' + p));
  process.exitCode = 1;
} else {
  console.log('\n  ✓ all element ids, asset paths and imports resolve\n');
}
