/**
 * Scene integration test.
 *
 * Builds the *entire* render-side scene graph (environment, props, player,
 * entities, particle pools) under a minimal DOM stub, then plays a full run
 * with the autopilot. Catches typos, bad three.js API usage, leaks and
 * broken recycling without needing a browser.
 *
 *   node tools/scene_test.mjs
 */
import * as THREE from '../vendor/three.module.js';

// ------------------------------------------------------------------ DOM stub
const gradient = { addColorStop() {} };
function ctx2d() {
  const base = {
    canvas: null,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    measureText: () => ({ width: 12 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData() {},
  };
  return new Proxy(base, {
    get: (t, k) => (k in t ? t[k] : () => {}),
    set: (t, k, v) => { t[k] = v; return true; },
  });
}
function canvasEl() {
  const c = { width: 64, height: 64, style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} } };
  c.getContext = () => { const g = ctx2d(); g.canvas = c; return g; };
  return c;
}
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? canvasEl() : { style: {}, appendChild() {}, addEventListener() {} }),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  body: { appendChild() {} },
};
globalThis.window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);

const { Assets, MANIFEST } = await import('../js/core/assets.js');
const { FX } = await import('../js/render/fx.js');
const { Environment } = await import('../js/render/environment.js');
const { CameraRig } = await import('../js/render/camera.js');
const { Run } = await import('../js/game/run.js');
const { makeRng } = await import('../js/core/rng.js');
const { WORLD, ZONES } = await import('../js/core/config.js');
const { autopilot } = await import('./headless_test.mjs');

// ------------------------------------------------------------------- setup
const noop = () => {};
const stubAudio = { play: noop, setIntensity: noop, setZone: noop, startMusic: noop, stopMusic: noop };

const assets = new Assets();
// pretend the load succeeded: real three.js textures + fake DOM images
for (const key of Object.keys(MANIFEST.textures)) {
  const t = new THREE.Texture(canvasEl());
  t.colorSpace = THREE.SRGBColorSpace;
  assets.three[key] = t;
}
for (const key of Object.keys(MANIFEST.images)) {
  assets.images[key] = { width: 128, height: 128, naturalWidth: 128, naturalHeight: 128 };
}
// exercise the real (canvas-based) character + hud paths
assets.characterFrames = Assets.prototype.characterFrames.bind(assets);

const failures = [];
const check = (cond, label) => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}`); failures.push(label); }
};

console.log('\n=== Temple Rush scene integration test ===\n');
console.log('building scene graph…');

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(ZONES[0].fog, ZONES[0].fogNear, ZONES[0].fogFar);
const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 700);
const rig = new CameraRig(camera);
let fx;
let env;
let run;
try {
  fx = new FX(scene, assets, 1);
  env = new Environment(scene, assets, fx, 'high');
  run = new Run({ scene, assets, fx, audio: stubAudio, env, camera: rig, rng: makeRng(2024) });
} catch (e) {
  console.error('FATAL while building scene:', e);
  process.exit(1);
}

check(scene.children.length > 20, `scene has content (${scene.children.length} top-level objects)`);
check(!!env.road && !!env.floor && !!env.kerbs, 'road, jungle floor and kerbs exist');
check(!!env.hemi && !!env.sun && env.sun.castShadow === true, 'lights exist and the sun casts shadows in high quality');
check(env.props.trees.length > 20 && env.props.foliage.length > 20, `jungle props pooled (${env.props.trees.length} trees, ${env.props.foliage.length} foliage)`);
check(scene.getObjectByProperty('isSprite', true) != null || fx.pools.glow.items.length > 0, 'particle pool instantiated');

// ---------------------------------------------------------- run the world
const dt = 1 / 60;
run.start({ cinematic: false });
const offsets = [];
const propZ = [];
let maxActive = 0;
let frameErrors = 0;
let sawObstacle = false;
let sawCoin = false;
let sawHowler = false;
let zoneSeen = new Set();
const startChildren = scene.children.length;

for (let i = 0; i < 60 * 40; i++) {          // 40 simulated seconds
  try {
    autopilot(run, { skill: 1 });
    run.update(dt);
    fx.update(dt);
  } catch (e) {
    frameErrors++;
    if (frameErrors < 3) console.error('  frame error:', e.message);
  }
  maxActive = Math.max(maxActive, run.entities.active.length);
  for (const e of run.entities.active) {
    if (e.kind === 'obstacle') sawObstacle = true;
    else if (e.type === 'coin') sawCoin = true;
    else if (e.type === 'howler') sawHowler = true;
  }
  zoneSeen.add(run.zone.id);
  if (i % 600 === 0) {
    offsets.push(env.roadMat.map.offset.y);
    propZ.push(env.props.trees.filter((p) => p.obj.position.z > WORLD.despawnZ + 1).length);
  }
}

check(frameErrors === 0, `simulated 40 s (${Math.floor(run.distance)} m) with zero frame errors`);
check(offsets[offsets.length - 1] > offsets[0], 'road texture scrolls as the runner advances');
check(propZ.every((n) => n === 0), 'all pooled props stay inside the recycle window');
check(maxActive < 220, `entity pool bounded (peak ${maxActive} live entities)`);
check(scene.children.length - startChildren < 40, `no unbounded scene growth (+${scene.children.length - startChildren} objects)`);
check(sawObstacle && sawCoin, `track streams obstacles + coins (peaks at ${maxActive} live entities)`);

// ------------------------------------------------------------- zone swap
console.log('\nforcing zone transitions…');
for (let i = 0; i < ZONES.length; i++) {
  env.applyZone(ZONES[i], true);
  for (let k = 0; k < 30; k++) {
    env.update(dt, 1, 20, { x: 0, z: 0 }, 0.5);
    fx.update(dt);
  }
}
check(env.zone.id === ZONES[ZONES.length - 1].id, `environment switched to "${env.zone.name}"`);
check(Number.isFinite(env.sun.intensity) && env.sun.intensity > 0, 'sun intensity valid after zone blend');
check(env.farTemples.length === 3 && env.farTemples[0].children.length >= 4
  && Number.isFinite(env.farTemples[0].children[0].material.opacity), 'far temple pyramids animate');

// --------------------------------------------------------- camera + powers
console.log('\ncamera, powers and death…');
rig.update(dt, { player: run.player, speed: 30, speedRatio: 0.6, boosting: true, dead: false, shake: 0.4 });
check(Number.isFinite(camera.position.x) && Number.isFinite(camera.fov), 'camera rig produces finite transforms');
rig.menuUpdate(dt, run.player);
check(camera.position.y > 0, 'menu camera orbits above the track');
rig.introUpdate(0.5, run.player);
check(Number.isFinite(camera.position.z), 'intro fly-in is animatable');

// keep the runner alive while exercising the power-up timers
run.entities.releaseAll();
run.invuln = 1e6;
run.powers.magnet = 5; run.powers.boost = 5; run.powers.shield = true; run.powers.x2 = 5;
for (let i = 0; i < 120; i++) { autopilot(run, { skill: 1 }); run.update(dt); fx.update(dt); }
check(run.powers.magnet > 0 && run.powers.shield, 'power-ups tick without breaking the run');
check(run.powers.boost > 0 && run.player.material.color.getHex() !== 0xffffff, 'turbo recolours the runner');

// Score ×2 power-up must double distance scoring
{
  run.entities.releaseAll();
  if (run.isOver) run.revive();
  run.player.reset();
  run.invuln = 1e6;
  run.state = 'playing';
  run.powers.x2 = 0; run.powers.boost = 0;
  const s0 = run.score;
  run.update(1.0);
  const base = run.score - s0;
  const s1 = run.score;
  run.powers.x2 = 10;
  run.update(1.0);
  const doubled = run.score - s1;
  check(base > 0 && doubled > base * 1.85, 'score ×2 power-up doubles distance scoring');
  run.powers.x2 = 0;
}

run.entities.releaseAll();
if (run.isOver) run.revive();
run.player.reset();
run.invuln = 1e6;
const coinsBefore = run.coins;
const coinEntity = run.entities.spawn('coin', { lane: run.player.lane, y: 1.0, z: -0.4 });
run.update(dt);
check(run.coins > coinsBefore && (!coinEntity.alive || coinEntity.meta.taken), 'coins can be collected');

run._die('obstacle');
for (let i = 0; i < 200; i++) { run.update(dt); fx.update(dt); }
check(run.state === 'dead', 'death sequence completes');
const deadDistance = run.distance;
run.revive();
const nearAfterRevive = run.entities.active.filter((e) => e.group.position.z > -32 && e.group.position.z < 4).length;
for (let i = 0; i < 60; i++) { run.update(dt); fx.update(dt); }
check(run.state === 'playing' && run.distance > deadDistance, 'revive resumes the run');
check(nearAfterRevive === 0, `revive clears the track around the player (${nearAfterRevive} left)`);
check(run.player.dead === false && run.invuln > 0, 'revive grants invulnerability');

run.dispose();
check(run.entities.active.length === 0, 'dispose releases every entity');

console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`}\n`);
if (failures.length) process.exitCode = 1;
