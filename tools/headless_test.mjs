/**
 * Headless gameplay harness.
 *
 * Runs the real Run simulation (physics, spawning, collisions, coins) with a
 * stubbed renderer/audio, and plays it with an autopilot so difficulty can be
 * tuned and regressions caught without a browser.
 *
 *   node tools/headless_test.mjs            # balanced report
 *   node tools/headless_test.mjs --seeds 12
 */
import * as THREE from '../vendor/three.module.js';
import { Run } from '../js/game/run.js';
import { makeRng, clamp } from '../js/core/rng.js';
import { LANES, SPEED } from '../js/core/config.js';
import { OBSTACLES } from '../js/game/entities.js';

// ------------------------------------------------------------------ stubs
const noop = () => {};
const stubFx = {
  shake: 0,
  spawn: () => null, burst: noop, coinPickup: noop, runDust: noop, strafePuff: noop,
  landPuff: noop, slideTrail: noop, ring: noop, hitBurst: noop, boostTrail: noop,
  firePuff: noop, trail: noop, magicBurst: noop, powerupBurst: noop, shieldHit: noop,
  speedLines: noop, confetti: noop, clear: noop, update: noop,
};
const stubAudio = {
  play: noop, setIntensity: noop, setZone: noop, startMusic: noop, stopMusic: noop,
};
const stubAssets = {
  tex: () => null,
  images: {},
  characterFrames: () => [null, null, null, null],
};

function makeRun(seed) {
  const rng = makeRng(seed);
  const run = new Run({
    scene: new THREE.Scene(),
    assets: stubAssets,
    fx: stubFx,
    audio: stubAudio,
    env: null,
    camera: null,
    rng,
  });
  return run;
}

// -------------------------------------------------------------- autopilot
const JUMP_VY = 13.9, JUMP_G = -37.5;
const PLAYER_HALF = 0.42;

/** [t1,t2] seconds into a jump during which the feet clear `clearance`. */
function airborneWindow(clearance) {
  const h = Math.max(0.05, clearance);
  const disc = JUMP_VY * JUMP_VY - 2 * Math.abs(JUMP_G) * h;
  if (disc <= 0) return [0.25, 0.35];
  const root = Math.sqrt(disc);
  return [(JUMP_VY - root) / Math.abs(JUMP_G), (JUMP_VY + root) / Math.abs(JUMP_G)];
}

/** Does an entity's x-extent overlap a given x position? */
function overlapsX(e, x, pad = 0.14) {
  const hw = (e.hitbox ? e.hitbox.halfW : (e.radius || 0.5));
  return Math.abs(e.group.position.x - x) < hw + PLAYER_HALF + pad;
}

/**
 * A competent human stand-in: keeps a ~1.2 s threat picture per lane, plans
 * the safest+richest lane, and fires jumps/slides inside the physical window.
 */
export function autopilot(run, opts = {}) {
  const skill = opts.skill != null ? opts.skill : 1;
  const p = run.player;
  const speed = Math.max(6, run.speed);
  const lead = 0.50 + skill * 0.75;           // danger look-ahead, seconds
  const sloppy = (1 - skill) * 0.26;          // reaction sloppiness (late jumps)

  const threats = [];       // {t, hb, dz, ttc, lane, action, e}
  const laneCoin = [0, 0, 0];
  let fireball = null;

  for (const e of run.entities.active) {
    const g = e.group.position;
    const dz = -g.z;
    if (dz < -2.5) continue;
    const lane = nearestLane(g.x);

    if (e.type === 'coin' && !e.meta.taken) {
      if (dz < 36) laneCoin[lane] += e.meta.dzBank != null ? 0 : (3 + Math.max(0, 14 - dz) * 0.5);
      continue;
    }
    if (e.type === 'powerup' && !e.meta.taken) { if (dz < 36) laneCoin[lane] += 30; continue; }
    if (e.type === 'idol' && !e.meta.taken) { if (dz < 36) laneCoin[lane] += 45; continue; }
    if (e.type === 'fireball') {
      if (dz > 0.1 && dz < 26) fireball = { x: g.x, dz, y: g.y };
      continue;
    }
    if (dz > 44) continue;

    if (e.type === 'howler' && !e.meta.chaser) {
      threats.push({ t: 'howler', dz, ttc: dz / speed, lane, action: 'dodge', halfW: 1.0, e });
      continue;
    }
    if (e.kind !== 'obstacle') continue;
    const hb = e.hitbox || OBSTACLES[e.type];
    if (!hb) continue;
    threats.push({ t: e.type, hb, dz, ttc: dz / speed, lane, action: hb.action, e });
  }

  // ---- lane cost model: danger dominates, coins are a tiebreaker
  const laneState = [0, 1, 2].map((l) => {
    let danger = 0;
    let hardBlock = false;
    let jumpClearance = 0;
    let jumpTtc = Infinity;
    let slideTtc = Infinity;
    let solidTtc = Infinity;
    for (const th of threats) {
      const laneX = LANES[l];
      const overlaps = overlapsX(th.e, laneX);
      if (!overlaps) continue;
      const ttc = th.ttc;
      if (ttc > lead) continue;
      if (th.action === 'jump') {
        jumpClearance = Math.max(jumpClearance, th.hb.yMax);
        jumpTtc = Math.min(jumpTtc, ttc);
      } else if (th.action === 'slide') {
        slideTtc = Math.min(slideTtc, ttc);
      } else if (ttc < 0.42) {
        hardBlock = true;
        solidTtc = Math.min(solidTtc, ttc);
      }
      danger += Math.max(0, lead - ttc);
    }
    return { lane: l, danger, hardBlock, jumpClearance, jumpTtc, slideTtc, solidTtc };
  });

  const cur = laneState[p.lane];
  const actions = [];
  let target = p.lane;

  // ---- lateral planning: survival first, coins only as a tiebreaker
  const canEnter = (l) => l >= 0 && l <= 2 && laneState[l].solidTtc > 0.30;
  const safetyCost = (l) => laneState[l].danger * 10 + (laneState[l].hardBlock ? 8 : 0);
  const stepToward = (goal) => (goal < p.lane ? 'left' : 'right');

  const urgent = cur.hardBlock || cur.danger > 0.35;
  if (urgent) {
    let best = null;
    let bestCost = safetyCost(p.lane) - 0.35;
    const candidates = [];
    for (const l of [0, 1, 2]) {
      if (l === p.lane) continue;
      const dist = Math.abs(l - p.lane);
      if (dist === 1) candidates.push(l);
      else if (canEnter((l + p.lane) / 2)) candidates.push(l);   // two-step: middle must be enterable
    }
    for (const l of candidates) {
      if (!canEnter(l) && Math.abs(l - p.lane) === 1) continue;
      const cost = safetyCost(l) - laneCoin[l] * 0.04;
      if (cost < bestCost) { bestCost = cost; best = l; }
    }
    if (best != null) {
      const step = Math.abs(best - p.lane) > 1 ? (best > p.lane ? p.lane + 1 : p.lane - 1) : best;
      if (step !== p.lane && canEnter(step)) target = step;
    }
  } else {
    // calm: drift toward coins / power-ups when the neighbouring lane is safe
    for (const l of [p.lane - 1, p.lane + 1]) {
      if (!canEnter(l)) continue;
      if (laneCoin[l] > laneCoin[target] + 9) target = l;
    }
  }
  if (target !== p.lane) actions.push(stepToward(target));

  // ---- vertical actions for whatever we are facing
  const facing = laneState[target];
  const hb = { clearance: Math.max(facing.jumpClearance, 0) };
  if (facing.jumpTtc < Infinity) {
    const [t1, t2] = airborneWindow(hb.clearance);
    if (facing.jumpTtc > t1 + 0.02 + sloppy && facing.jumpTtc < t2 - 0.16 - sloppy * 0.5 && p.y < 0.05 && p.state !== 'slide') {
      actions.push('jump');
    }
    // never enter a jump obstacle's lane too late to clear it
    if (facing.jumpTtc < t1 && target !== p.lane) actions.length = 0;
  }
  if (facing.slideTtc < Infinity && facing.slideTtc > 0.04 && facing.slideTtc < 0.30 - sloppy * 0.4 && p.y < 0.05 && p.state !== 'slide') {
    actions.push('slide');
  }

  // ---- fireballs: slide under them (they fly at chest height)
  if (fireball && Math.abs(fireball.x - p.x) < 0.75) {
    const ttc = fireball.dz / speed;
    if (ttc < 0.30 && ttc > 0.04 && p.y < 0.05 && p.state !== 'slide') actions.push('slide');
  } else if (fireball && fireball.dz / speed < 0.6) {
    const away = fireball.x <= 0 ? 1 : -1;
    const l = clamp(p.lane + away, 0, 2);
    if (l !== p.lane && canEnter(l)) actions.push(away < 0 ? 'left' : 'right');
  }

  for (const a of actions) run.input(a);
  run._botActions = actions;
  return actions;
}

function nearestLane(x) {
  let best = 0; let bd = Infinity;
  for (let i = 0; i < 3; i++) {
    const d = Math.abs(x - LANES[i]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// ------------------------------------------------------------------- sims
export function simulate({ seed = 1, skill = 1, maxSeconds = 400, cinematic = false, onTick = null } = {}) {
  const run = makeRun(seed);
  run.start({ cinematic });
  const dt = 1 / 60;
  let t = 0;
  let frames = 0;
  const events = { deaths: [], coins: 0, powerups: [], zones: [], maxCombo: 0, stumbles: 0, idols: 0 };
  run.bus.on('coin', (e) => { events.coins = e.total; });
  run.bus.on('powerup', (e) => events.powerups.push(e.power));
  run.bus.on('zone', (z) => events.zones.push(z.id));
  let deathDump = null;
  run.bus.on('dying', (e) => {
    deathDump = {
      reason: e.reason,
      lane: run.player.lane,
      speed: run.speed,
      obstacles: run.entities.active
        .filter((x) => Math.abs(x.group.position.z) < 26)
        .map((x) => ({ t: x.type, x: +x.group.position.x.toFixed(2), z: +x.group.position.z.toFixed(1) })),
    };
  });
  run.bus.on('death', (e) => events.deaths.push(e.reason));
  run.bus.on('stumble', () => { events.stumbles++; });
  run.bus.on('idol', () => { events.idols++; });

  let overTime = 0;
  while (t < maxSeconds && (overTime < 3.2)) {
    if (run.isOver) overTime += dt;
    if (skill >= 0 && t > (run.state === 'intro' ? 3.4 : 0)) autopilot(run, { skill });
    run.update(dt);
    run.fx.update && run.fx.update(dt);
    t += dt;
    frames++;
    if (!Number.isFinite(run.player.x) || !Number.isFinite(run.player.y) || !Number.isFinite(run.distance)) {
      throw new Error(`NaN in sim at t=${t.toFixed(2)} state=${run.state}`);
    }
    if (onTick) onTick(run, t);
    if (run.entities.active.length > 400) throw new Error(`entity leak: ${run.entities.active.length}`);
  }
  return {
    survived: run.state !== 'dead' && run.state !== 'dying',
    distance: Math.floor(run.distance),
    score: Math.floor(run.score),
    coins: run.coins,
    maxCombo: run.maxCombo,
    speed: run.speed,
    seconds: t,
    frames,
    stumbles: events.stumbles,
    powerups: events.powerups,
    zones: events.zones,
    deaths: events.deaths,
    reason: run.deathReason,
    deathDump,
    eventCoins: events.coins,
    run,
  };
}

// ------------------------------------------------------------------- main
const args = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeds = getArg('--seeds', 6);
  const maxSeconds = getArg('--seconds', 300);
  console.log(`\n=== Temple Rush headless harness (${seeds} seeds, up to ${maxSeconds}s each) ===\n`);

  const rows = [];
  let crashes = 0;
  for (let s = 1; s <= seeds; s++) {
    let res;
    try {
      res = simulate({ seed: s * 977, skill: 1, maxSeconds });
    } catch (e) {
      crashes++;
      console.log(`seed ${s}: CRASH ${e.message}`);
      continue;
    }
    rows.push(res);
    const status = res.survived ? 'survived' : `died(${res.deaths[0] || '?'})`;
    console.log(
      `seed ${String(s).padStart(2)}: ${status.padEnd(16)} ` +
      `${String(res.distance).padStart(6)}m  score ${String(res.score).padStart(7)}  ` +
      `coins ${String(res.coins).padStart(4)}  combo ${String(res.maxCombo).padStart(3)}  ` +
      `zones ${res.zones.join('>') || '-'}  speed ${res.speed.toFixed(1)}  stumbles ${res.stumbles}  reason ${res.reason || 'survived'}`,
    );
    if (res.deathDump && process.env.DEBUG_DEATH) {
      console.log('        death dump:', JSON.stringify(res.deathDump));
    }
  }

  const avg = (f) => rows.length ? rows.reduce((a, r) => a + f(r), 0) / rows.length : 0;
  console.log('\n--- summary ---');
  console.log(`survival rate : ${rows.filter((r) => r.survived).length}/${rows.length}`);
  console.log(`avg distance  : ${Math.round(avg((r) => r.distance))} m`);
  console.log(`avg score     : ${Math.round(avg((r) => r.score))}`);
  console.log(`avg coins     : ${Math.round(avg((r) => r.coins))}`);
  console.log(`max speed seen: ${Math.max(...rows.map((r) => r.speed), 0).toFixed(1)} / ${SPEED.max}`);
  console.log(`crashes       : ${crashes}`);

  // a deliberately sloppy player should definitely die (the game must bite)
  const sloppy = simulate({ seed: 4242, skill: 0.15, maxSeconds: 240 });
  console.log(`\nsloppy bot    : ${sloppy.survived ? 'SURVIVED (too easy!)' : `died after ${Math.floor(sloppy.distance)}m (${sloppy.deaths[0]})`}`);

  const idle = simulate({ seed: 99, skill: 0, maxSeconds: 240 });
  console.log(`idle bot      : ${idle.survived ? 'SURVIVED (bug!)' : `died after ${Math.floor(idle.distance)}m (${idle.deaths[0]})`}`);

  const noInput = simulate({ seed: 99, skill: -1, maxSeconds: 240 });
  console.log(`no-input bot  : ${noInput.survived ? 'SURVIVED (bug!)' : `died after ${Math.floor(noInput.distance)}m (${noInput.deaths[0]})`}`);

  if (crashes) process.exitCode = 1;
}
