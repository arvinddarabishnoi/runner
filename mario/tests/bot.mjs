// Headless autopilot used by the test-suite to prove every shipped level is completable.
// Each frame on the ground it simulates two short futures on a copy of the real game
// (keep walking vs. hop now) and takes the hop only when walking leads to a death or a
// stall and hopping is survivable. It is a test oracle, not a player model.
import { Game } from '../js/game.js';
import { TILE } from '../js/config.js';

const WALK = { left: false, right: true, run: true, jumpHeld: false, jumpPressed: false };
const HOP = { left: false, right: true, run: true, jumpHeld: true, jumpPressed: true };
const HOLD = { ...WALK, jumpHeld: true }; // keep the jump held while airborne for a full hop
const WALK_HORIZON = 40; // frames (~0.45 s, ~2.5 tiles) — hop just in time, not early
const HOP_HORIZON = 50;  // the hop must clear the obstacle; the bot re-decides on landing
const DT = 1 / 60;

function cloneInto(real, levelData) {
  const g = new Game(levelData, { lives: 1, score: 0, coins: 0 });
  Object.assign(g.hero, real.hero);
  g.level.grid = real.level.grid.map((r) => r.slice());
  g.enemies = real.enemies.map((e) => Object.assign(Object.create(Object.getPrototypeOf(e)), e));
  g.coins = real.coins.map((c) => ({ ...c }));
  g.mushrooms = [];
  g.popups = [];
  g.debris = [];
  return g;
}

/** true if, after `first` input and then holding a steady course, the hero survives and makes progress. */
function survives(real, levelData, first) {
  const g = cloneInto(real, levelData);
  const startX = g.hero.x;
  const horizon = first.jumpHeld ? HOP_HORIZON : WALK_HORIZON;
  g.update(DT, first);
  const rest = first.jumpHeld ? HOLD : WALK;
  for (let i = 1; i < horizon; i++) {
    g.update(DT, rest);
    if (g.state === 'lost' || g.state === 'dying') return false;
    if (g.state === 'cleared') return true;
  }
  return g.hero.x - startX > TILE * 0.5;
}

export function decide(game, levelData) {
  const h = game.hero;
  if (!h.onGround) return h.jumping ? HOLD : WALK;
  if (survives(game, levelData, WALK)) return WALK;
  if (survives(game, levelData, HOP)) return HOP;
  return WALK;
}

export function runBot(levelData, { maxSeconds = 300 } = {}) {
  let session = { lives: 3, score: 0, coins: 0 };
  let game = new Game(levelData, session);
  let deaths = 0;
  let frames = 0;
  while (frames * DT < maxSeconds) {
    game.update(DT, decide(game, levelData));
    frames++;
    game.drainEvents();
    if (game.state === 'lost') {
      deaths++;
      if (deaths >= 3) return { cleared: false, deaths, t: frames * DT, reason: 'game over', at: game.hero.x, cause: game.deathReason };
      game = new Game(levelData, { lives: 3 - deaths, score: 0, coins: 0 });
    }
    if (game.state === 'cleared') return { cleared: true, deaths, t: frames * DT, score: session.score, time: game.timeUsed };
  }
  return { cleared: false, deaths, t: frames * DT, reason: 'timeout', at: game.hero.x };
}
