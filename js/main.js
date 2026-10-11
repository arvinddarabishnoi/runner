/**
 * Temple Rush: Curse of the Lost Kingdom — entry point.
 * An endless temple runner: original engine (three.js WebGL), generated art
 * pipeline (tools/process_assets.py) and synthesized audio (WebAudio).
 */
import { Game } from './app/game.js';

const canvas = document.getElementById('game-canvas');

// Guard against double-initialisation (hot reloads, bfcache restores).
if (!window.__TEMPLE_RUSH__) {
  const game = new Game(canvas);
  window.__TEMPLE_RUSH__ = game;
  game.boot().catch((err) => {
    console.error('Temple Rush failed to boot:', err);
    const hint = document.getElementById('load-hint');
    if (hint) hint.textContent = `Failed to start: ${err.message}`;
  });
}
