/**
 * Post-build step: copy the game's runtime asset tree into dist/.
 *
 * Vite rewrites and hashes only the assets it can see statically (img tags,
 * CSS url() references). The game loads most art at runtime through string
 * paths in js/core/assets.js (MANIFEST), so those files must be copied
 * verbatim. The 22 MB of raw source art in assets/raw/ is not needed at
 * runtime and stays out of the build.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'assets');
const dst = path.join(root, 'dist', 'assets');

const FOLDERS = ['sprites', 'textures', 'ui'];

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) count += copyDir(a, b);
    else {
      fs.copyFileSync(a, b);
      count++;
    }
  }
  return count;
}

let total = 0;
for (const folder of FOLDERS) {
  const from = path.join(src, folder);
  if (!fs.existsSync(from)) continue;
  total += copyDir(from, path.join(dst, folder));
}
console.log(`copy_assets: ${total} runtime asset files copied to dist/assets/`);
