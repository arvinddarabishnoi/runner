/**
 * Temple Rush — global tuning constants.
 * Coordinate system: the player runs toward -Z, lanes are spread on X,
 * +Y is up. Everything is measured in "world units" (~1 unit ≈ 0.6 m).
 */

export const LANES = [-2.25, 0, 2.25];
export const LANE_W = 2.25;

export const WORLD = {
  spawnZ: -235,      // where new track content appears
  despawnZ: 26,      // behind the camera, recycled past this
  camZ: 7.6,
  camY: 4.45,
  lookZ: -8.5,
  lookY: 1.85,
  fogNear: 30,
  fogFar: 135,
  skyRadius: 420,
};

export const SPEED = {
  start: 15.8,
  max: 44,
  accel: 0.62,       // units/s gained per second of running
  boostMul: 1.55,
  stumbleMul: 0.45,
};

export const JUMP = { vy: 13.9, g: -37.5, coyote: 0.12, buffer: 0.16 };
export const SLIDE = { time: 0.82, cooldown: 0.12 };

export const PLAYER = {
  halfW: 0.42,
  height: 1.72,
  slideHeight: 0.78,
  laneLerp: 14.5,
  leanMax: 0.34,
  radius: 0.42,
};

export const CAMERA = {
  fov: 62,
  laneFollow: 0.28,  // how much the camera drifts toward the player's lane
  shakeDecay: 4.2,
};

export const POWERUPS = {
  magnet: { time: 13, icon: 'magnet', label: 'Coin Magnet' },
  boost: { time: 7.5, icon: 'boost', label: 'Turbo' },
  shield: { time: 0, icon: 'shield', label: 'Shield' },
  x2: { time: 15, icon: 'x2', label: 'Score ×2' },
};

export const SCORE = {
  perUnit: 1.0,        // meters run
  perCoin: 10,
  perIdol: 500,
  powerup: 50,
  nearMiss: 5,
};

export const ECO = {
  baseCoin: 1,
  multiplierDuration: 15,
};

export const DIFF = {
  // difficulty 0..1 over this many meters
  rampMeters: 4200,
  obstacleGapMin: 12,   // meters between obstacle groups (hardest)
  obstacleGapMax: 34,   // (easiest)
  enemyChance: 0.22,
  doubleObstacleAfter: 0.25,
  tripleObstacleAfter: 0.6,
};

export const ZONES = [
  {
    id: 'jungle',
    name: 'Deep Jungle',
    at: 0,
    fog: 0x2c4a2a,
    fogNear: 26,
    fogFar: 120,
    hemiSky: 0xdff0b8,
    hemiGround: 0x2c3a1c,
    hemiIntensity: 0.85,
    sun: 0xffdcae,
    sunIntensity: 1.35,
    road: 'stone_path',
    decor: ['tree', 'foliage', 'hut', 'torch'],
  },
  {
    id: 'ruins',
    name: 'Ancient Ruins',
    at: 1600,
    fog: 0x4a3f2e,
    fogNear: 30,
    fogFar: 128,
    hemiSky: 0xffe0b0,
    hemiGround: 0x3a3020,
    hemiIntensity: 0.8,
    sun: 0xffc078,
    sunIntensity: 1.5,
    road: 'stone_path',
    decor: ['ruin', 'statue', 'torch', 'foliage'],
  },
  {
    id: 'temple',
    name: 'Temple of the Idol',
    at: 3400,
    fog: 0x3a2418,
    fogNear: 20,
    fogFar: 108,
    hemiSky: 0xffb46a,
    hemiGround: 0x2a1a10,
    hemiIntensity: 0.66,
    sun: 0xff9a4a,
    sunIntensity: 1.7,
    road: 'stone_path',
    decor: ['temple', 'statue', 'torch', 'statue'],
  },
];

export const QUALITY = {
  high: { dpr: 2.0, bloom: true, shadows: true, particles: 1.0, treeDensity: 1.0 },
  medium: { dpr: 1.5, bloom: true, shadows: false, particles: 0.7, treeDensity: 0.75 },
  low: { dpr: 1.0, bloom: false, shadows: false, particles: 0.45, treeDensity: 0.5 },
};

export const CHARACTERS = [
  { id: 'runner', name: 'Kiba', cost: 0, hue: 0, sat: 1.0, bright: 1.0, tint: 0xffffff, desc: 'The temple raider' },
  { id: 'jade', name: 'Jade Kiba', cost: 800, hue: 0.42, sat: 1.15, bright: 1.05, tint: 0xbfffd0, desc: 'Blessed by jade' },
  { id: 'ember', name: 'Ember Kiba', cost: 1800, hue: -0.5, sat: 1.3, bright: 1.0, tint: 0xffd0b0, desc: 'Born of the volcano' },
  { id: 'demon', name: 'Demon Kiba', cost: 3500, hue: 0.75, sat: 1.25, bright: 0.9, tint: 0xd7b0ff, desc: 'Sided with the beasts' },
];
