/**
 * Vite configuration for Temple Rush: Curse of the Lost Kingdom.
 *
 * The game also runs with zero build step (any static server), using the
 * import map in index.html. For production builds Vite bundles everything;
 * the aliases below make bare "three" specifiers (used by the vendored
 * addons) resolve to the same vendored module the browser uses, so exactly
 * one copy of three.js ends up in the bundle.
 */
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // relative base → the built dist/ can be hosted from any path or file://
  base: './',
  resolve: {
    alias: [
      { find: /^three\/addons\//, replacement: fileURLToPath(new URL('./vendor/addons/', import.meta.url)) },
      { find: /^three\/examples\/jsm\//, replacement: fileURLToPath(new URL('./vendor/addons/', import.meta.url)) },
      { find: 'three', replacement: fileURLToPath(new URL('./vendor/three.module.js', import.meta.url)) },
    ],
  },
  server: { host: '0.0.0.0', port: 4173, strictPort: false },
  preview: { host: '0.0.0.0', port: 4173, strictPort: false },
  build: {
    outDir: 'dist',
    // hashed bundles go to dist/static so dist/assets/ can hold the game's
    // runtime asset tree (copied by tools/copy_assets.mjs)
    assetsDir: 'static',
    chunkSizeWarningLimit: 2048,
  },
});
