// Loads every image and sound effect up front so the game never stalls mid-run.
// Keys map to files in mario/assets/ (Kenney.nl art and audio, CC0).
const A = 'assets/';

export const IMAGE_FILES = {
  // Hero (Kenney "Platformer Pack" character 1)
  stand: 'player/p1_stand.png',
  jump: 'player/p1_jump.png',
  hurt: 'player/p1_hurt.png',
  duck: 'player/p1_duck.png',
  ...Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`walk${i + 1}`, `player/p1_walk${String(i + 1).padStart(2, '0')}.png`])),
  // enemies
  slimeWalk1: 'enemies/slimeWalk1.png', slimeWalk2: 'enemies/slimeWalk2.png', slimeDead: 'enemies/slimeDead.png',
  snailWalk1: 'enemies/snailWalk1.png', snailWalk2: 'enemies/snailWalk2.png', snailShell: 'enemies/snailShell.png',
  flyFly1: 'enemies/flyFly1.png', flyFly2: 'enemies/flyFly2.png', flyDead: 'enemies/flyDead.png',
  // items & effects
  coinGold: 'items/coinGold.png', mushroomRed: 'items/mushroomRed.png',
  spikes: 'items/spikes.png', flagGreen: 'items/flagGreen.png',
  particleBrick1a: 'items/particleBrick1a.png', particleBrick1b: 'items/particleBrick1b.png',
  particleBrick2a: 'items/particleBrick2a.png', particleBrick2b: 'items/particleBrick2b.png',
  cloud1: 'items/cloud1.png', cloud2: 'items/cloud2.png', bush: 'items/bush.png',
  // tiles
  grassLeft: 'tiles/grassLeft.png', grassMid: 'tiles/grassMid.png', grassRight: 'tiles/grassRight.png',
  dirtLeft: 'tiles/dirtLeft.png', dirtCenter: 'tiles/dirtCenter.png', dirtRight: 'tiles/dirtRight.png',
  stoneLeft: 'tiles/stoneLeft.png', stoneMid: 'tiles/stoneMid.png', stoneRight: 'tiles/stoneRight.png',
  boxItem: 'tiles/boxItem.png', boxItemAlt: 'tiles/boxItemAlt.png', boxEmpty: 'tiles/boxEmpty.png',
  brickWall: 'tiles/brickWall.png', hillLarge: 'tiles/hill_large.png', hillSmall: 'tiles/hill_small.png',
  // HUD & backgrounds
  heartFull: 'ui/hud_heartFull.png', heartEmpty: 'ui/hud_heartEmpty.png', hudCoin: 'ui/hud_coins.png',
  bgGrass: 'bg/bg.png', bgCastle: 'bg/bg_castle.png',
};

export const SFX_FILES = {
  jump: 'sfx/jump.ogg', stomp: 'sfx/stomp.ogg', coin: 'sfx/coin.ogg', powerup: 'sfx/powerup.ogg',
  bump: 'sfx/bump.ogg', hurt: 'sfx/hurt.ogg', clear: 'sfx/clear.ogg', gameover: 'sfx/gameover.ogg',
  break: 'sfx/break.ogg',
};

export function loadImages(files = IMAGE_FILES, base = A) {
  const entries = Object.entries(files);
  return Promise.all(entries.map(([key, file]) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve([key, img]);
    img.onerror = () => reject(new Error(`Missing image: ${file}`));
    img.src = base + file;
  }))).then((pairs) => Object.fromEntries(pairs));
}

export function preloadSounds(files = SFX_FILES, base = A) {
  const out = {};
  for (const [key, file] of Object.entries(files)) {
    const a = new Audio(base + file);
    a.preload = 'auto';
    out[key] = a;
  }
  return out;
}
