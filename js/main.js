/**
 * Jungle Run — entry point.
 * An endless temple runner: original engine (three.js WebGL), generated art
 * pipeline (tools/process_assets.py) and synthesized audio (WebAudio).
 */
import { Game } from './app/game.js';

const canvas = document.getElementById('game-canvas');

// Guard against double-initialisation (hot reloads, bfcache restores).
if (!window.__JUNGLE_RUN__) {
  const game = new Game(canvas);
  window.__JUNGLE_RUN__ = game;
  game.boot().catch((err) => {
    console.error('Jungle Run failed to boot:', err);
    const hint = document.getElementById('load-hint');
    if (hint) hint.textContent = `Failed to start: ${err.message}`;
  });
}
